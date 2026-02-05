import http.server
import socketserver
import socket
import subprocess
import time
import sys
import os
import json
import base64
import mimetypes
import urllib.parse
import io
import threading

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# Base path is the miru_ui_module directory
MODULE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBROOT = os.path.join(MODULE_ROOT, "webroot")

# Scrcpy Configuration
# Try standard PC path first, then fallback to Module path
SCRCPY_SERVER_PATH_PC = os.path.join(
    MODULE_ROOT, "tools", "scrcpy", "scrcpy-win64-v2.4", "scrcpy-server"
)
SCRCPY_SERVER_PATH_MOD = os.path.join(MODULE_ROOT, "tools", "scrcpy-server.jar")

if os.path.exists(SCRCPY_SERVER_PATH_PC):
    SCRCPY_SERVER_PATH = SCRCPY_SERVER_PATH_PC
else:
    SCRCPY_SERVER_PATH = SCRCPY_SERVER_PATH_MOD

DEVICE_SCRCPY_PATH = "/data/local/tmp/scrcpy-server.jar"
SCRCPY_PORT = 27183
SCRCPY_SOCKET_NAME = "scrcpy"  # Default socket name
SCRCPY_PROC = None
SCRCPY_LOCK = threading.Lock()


def ensure_scrcpy_server():
    global SCRCPY_PROC

    with SCRCPY_LOCK:
        # Check if process is alive
        if SCRCPY_PROC and SCRCPY_PROC.poll() is None:
            return True

        print("[Scrcpy] Starting server...")
        adb_cmd = get_adb_base_cmd()

        # 1. Push Server
        # Only push if missing or force? Let's push always to be safe, it's fast on USB
        try:
            subprocess.run(
                adb_cmd + ["push", SCRCPY_SERVER_PATH, DEVICE_SCRCPY_PATH],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"[Scrcpy] Push failed: {e}")
            return False

        # 2. Forward Port
        try:
            subprocess.run(
                adb_cmd
                + [
                    "forward",
                    f"tcp:{SCRCPY_PORT}",
                    f"localabstract:{SCRCPY_SOCKET_NAME}",
                ],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"[Scrcpy] Forward failed: {e}")
            return False

        # 3. Start Server
        # Arguments for Scrcpy 2.4 (Raw H.264 Stream)
        cmd = adb_cmd + [
            "shell",
            "CLASSPATH=" + DEVICE_SCRCPY_PATH,
            "app_process",
            "/",
            "com.genymobile.scrcpy.Server",
            "2.4",
            "log_level=info",
            "tunnel_forward=true",
            "video=true",
            "audio=false",
            "control=false",
            "send_device_meta=false",
            "send_frame_meta=false",
            "send_dummy_byte=false",
            "send_codec_meta=false",
            "raw_stream=true",
            "max_size=1024",  # Limit resolution for performance if needed, or remove for full res
        ]

        try:
            SCRCPY_PROC = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            # Wait a bit for startup
            time.sleep(1)
            if SCRCPY_PROC.poll() is not None:
                print(
                    f"[Scrcpy] Server exited immediately. Code: {SCRCPY_PROC.returncode}"
                )
                if SCRCPY_PROC.stderr:
                    print(SCRCPY_PROC.stderr.read().decode("utf-8", errors="ignore"))
                return False
            print("[Scrcpy] Server started!")
            return True
        except Exception as e:
            print(f"[Scrcpy] Failed to start process: {e}")
            return False


# Configuration
PORT = 8000
DEVICE_WIDTH = 720
DEVICE_HEIGHT = 1600

CACHED_ADB_CMD = None
RESOLUTION_DETECTED = False


def get_adb_base_cmd():
    """Returns ['adb', '-s', 'serial'] if needed, or just ['adb']"""
    global CACHED_ADB_CMD
    if CACHED_ADB_CMD:
        return CACHED_ADB_CMD

    # Check Environment Variable first
    serial = os.environ.get("ANDROID_SERIAL")
    if serial:
        CACHED_ADB_CMD = ["adb", "-s", serial]
        return CACHED_ADB_CMD

    try:
        # Check devices
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        lines = res.stdout.strip().split("\n")[1:]  # Skip header
        devices = [
            line.split()[0] for line in lines if line.strip() and "device" in line
        ]

        if len(devices) == 0:
            CACHED_ADB_CMD = ["adb"]  # Let it fail naturally
        elif len(devices) == 1:
            CACHED_ADB_CMD = ["adb"]  # Only one, no need to specify
        else:
            # If multiple, prefer USB (not starting with 192 or containing :)
            # R92X70K8D9N vs 192.168.1.80:5555
            usb_devices = [
                d for d in devices if ":" not in d and not d.startswith("192.")
            ]

            if usb_devices:
                target = usb_devices[0]
                print(f"[Info] Multiple devices found. Preferring USB: {target}")
            else:
                target = devices[0]
                print(f"[Info] Multiple devices found. Selecting first: {target}")

            CACHED_ADB_CMD = ["adb", "-s", target]

        return CACHED_ADB_CMD
    except:
        return ["adb"]


def update_device_resolution():
    global DEVICE_WIDTH, DEVICE_HEIGHT, RESOLUTION_DETECTED
    try:
        cmd = get_adb_base_cmd() + ["shell", "wm", "size"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        # Output: Physical size: 1080x2400
        if res.returncode == 0 and "Physical size:" in res.stdout:
            parts = res.stdout.split(":")[1].strip().split("x")
            if len(parts) == 2:
                DEVICE_WIDTH = int(parts[0])
                DEVICE_HEIGHT = int(parts[1])
                RESOLUTION_DETECTED = True
                print(
                    f"[Info] Device Resolution Detected: {DEVICE_WIDTH}x{DEVICE_HEIGHT}"
                )
    except Exception as e:
        print(
            f"[Info] Failed to detect resolution, using default {DEVICE_WIDTH}x{DEVICE_HEIGHT}: {e}"
        )


# Initial detection
update_device_resolution()


class MiruHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBROOT, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "X-Requested-With, Content-Type"
        )
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        print(f"[DEBUG] POST: {self.path}")

        # Handle Wireless Connect (Vysor Logic)
        if self.path.startswith("/api/device/wireless"):
            try:
                # 1. Get IP from current connection (assuming USB)
                print("[Wireless] Attempting to switch to Wireless...")
                cmd_ip = get_adb_base_cmd() + [
                    "shell",
                    "ip",
                    "-f",
                    "inet",
                    "addr",
                    "show",
                    "wlan0",
                ]
                res = subprocess.run(cmd_ip, capture_output=True, text=True)
                ip = None
                # Parse: inet 192.168.1.45/24 ...
                for line in res.stdout.splitlines():
                    if "inet " in line:
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            ip = parts[1].split("/")[0]
                            break

                if not ip:
                    # Try wlan1 just in case
                    cmd_ip2 = get_adb_base_cmd() + [
                        "shell",
                        "ip",
                        "-f",
                        "inet",
                        "addr",
                        "show",
                        "wlan1",
                    ]
                    res2 = subprocess.run(cmd_ip2, capture_output=True, text=True)
                    for line in res2.stdout.splitlines():
                        if "inet " in line:
                            parts = line.strip().split()
                            if len(parts) >= 2:
                                ip = parts[1].split("/")[0]
                                break

                if not ip:
                    raise Exception("Could not find Device IP (wlan0/wlan1)")

                print(f"[Wireless] Found IP: {ip}")

                # 2. Enable TCP/IP on 5555
                print("[Wireless] Enabling TCP/IP 5555...")
                subprocess.run(get_adb_base_cmd() + ["tcpip", "5555"], check=True)
                time.sleep(2)  # Wait for device to restart adbd

                # 3. Connect
                print(f"[Wireless] Connecting to {ip}:5555...")
                subprocess.run(["adb", "connect", f"{ip}:5555"], check=True)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "ip": ip}).encode())

            except Exception as e:
                print(f"[Wireless] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(str(e).encode())
            return

        # Handle Resolution Change (Turbo Mode)
        if self.path.startswith("/api/device/resolution"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)

                action = data.get("action")  # 'set' or 'reset'

                if action == "reset":
                    cmd = get_adb_base_cmd() + ["shell", "wm", "size", "reset"]
                    print("[Stream] Resetting Resolution...")
                elif action == "set":
                    target_w = data.get("width")
                    target_h = data.get("height")
                    if target_w and target_h:
                        cmd = get_adb_base_cmd() + [
                            "shell",
                            "wm",
                            "size",
                            f"{target_w}x{target_h}",
                        ]
                        print(
                            f"[Stream] Setting Resolution to {target_w}x{target_h}..."
                        )
                    else:
                        raise ValueError("Missing width/height")

                # Run command
                subprocess.run(cmd, check=True)

                # Wait a bit for system to apply
                time.sleep(1)

                # Update internal state
                update_device_resolution()

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "status": "ok",
                            "width": DEVICE_WIDTH,
                            "height": DEVICE_HEIGHT,
                        }
                    ).encode()
                )

            except Exception as e:
                print(f"[Error] Resolution change failed: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(str(e).encode())
            return

        # Handle Save File (PC Sync)
        if self.path == "/api/save":
            try:
                content_length = int(self.headers["Content-Length"])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode("utf-8"))

                device_path = data.get("path", "")
                content = data.get("content", "")  # Plain text content

                print(f"[Save] Path: {device_path}")

                local_path = None
                if "/miru_ui_module/scripts/" in device_path:
                    rel_path = device_path.split("/miru_ui_module/scripts/")[1]
                    local_path = os.path.join(
                        MODULE_ROOT, "scripts", rel_path.replace("/", os.sep)
                    )
                elif "/miru_ui_module/webroot/" in device_path:
                    rel_path = device_path.split("/miru_ui_module/webroot/")[1]
                    local_path = os.path.join(
                        MODULE_ROOT, "webroot", rel_path.replace("/", os.sep)
                    )

                if local_path:
                    # 1. Save to Local PC
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    with open(local_path, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"[Save] Saved to local: {local_path}")

                    # 2. Push to Device (Sync)
                    cmd = get_adb_base_cmd() + ["push", local_path, device_path]
                    subprocess.check_call(cmd)

                    # 3. Ensure executable permissions for scripts
                    if device_path.endswith(".sh") or device_path.endswith(
                        "run_miru.sh"
                    ):
                        subprocess.run(
                            get_adb_base_cmd() + ["shell", f"chmod +x {device_path}"]
                        )

                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(
                        json.dumps(
                            {"status": "ok", "msg": "Saved to PC & Device"}
                        ).encode("utf-8")
                    )
                else:
                    print(f"[Error] Could not map path: {device_path}")
                    self.send_error(400, "Invalid path mapping")
            except Exception as e:
                print(f"[Error] Save failed: {e}")
                self.send_error(500, str(e))
            return

        # Handle CGI Exec Proxy
        if self.path.startswith("/cgi-bin/exec"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                cmd_str = self.rfile.read(content_length).decode("utf-8")

                # Safe print for Windows consoles
                safe_cmd = cmd_str.encode("ascii", "replace").decode("ascii")
                print(f"[CGI] Executing: {safe_cmd}")

                # Use base64 to avoid quoting hell
                cmd_b64 = base64.b64encode(cmd_str.encode("utf-8")).decode("utf-8")

                # Command to run on device as Root
                # echo <b64> | base64 -d | sh
                device_cmd = f"su -c 'echo {cmd_b64} | base64 -d | sh'"

                adb_cmd = get_adb_base_cmd() + ["shell", device_cmd]

                res = subprocess.run(adb_cmd, capture_output=True)

                # Encode outputs
                stdout_b64 = base64.b64encode(res.stdout).decode("utf-8")
                stderr_b64 = base64.b64encode(res.stderr).decode("utf-8")
                exit_code = res.returncode

                response = {
                    "errno": exit_code,
                    "stdout_b64": stdout_b64,
                    "stderr_b64": stderr_b64,
                }

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode("utf-8"))

            except Exception as e:
                print(f"[CGI] Error: {e}")
                # Return JSON error
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                err_response = {
                    "errno": 255,
                    "stdout_b64": "",
                    "stderr_b64": base64.b64encode(str(e).encode("utf-8")).decode(
                        "utf-8"
                    ),
                }
                self.wfile.write(json.dumps(err_response).encode("utf-8"))
            return

        # Default for unknown POST
        self.send_response(404)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_GET(self):
        # print(f"[DEBUG] GET: {self.path}")

        # Handle Input Tap (Remote Control)
        if self.path.startswith("/api/input/tap"):
            try:
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                rx = float(params.get("x", [0])[0])
                ry = float(params.get("y", [0])[0])

                real_x = int(rx * DEVICE_WIDTH)
                real_y = int(ry * DEVICE_HEIGHT)

                print(f"[Input] Tap: {real_x}, {real_y}")
                cmd = get_adb_base_cmd() + [
                    "shell",
                    "input",
                    "tap",
                    str(real_x),
                    str(real_y),
                ]
                subprocess.run(cmd)  # Blocking tap

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"OK")
            except Exception as e:
                print(f"[Input] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Input Key (Remote Control)
        if self.path.startswith("/api/input/key"):
            try:
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                keycode = params.get("keycode", [""])[0]

                if keycode:
                    print(f"[Input] Key: {keycode}")
                    cmd = get_adb_base_cmd() + [
                        "shell",
                        "input",
                        "keyevent",
                        str(keycode),
                    ]
                    subprocess.Popen(cmd)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"OK")
            except Exception as e:
                print(f"[Input] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Scrcpy Launch
        if self.path.startswith("/api/launch/scrcpy"):
            try:
                # Check if we are on Windows Host
                if os.name == "nt":
                    scrcpy_path = os.path.join(
                        MODULE_ROOT,
                        "tools",
                        "scrcpy",
                        "scrcpy-win64-v2.4",
                        "scrcpy.exe",
                    )
                    if os.path.exists(scrcpy_path):
                        print(f"[Stream] Launching Scrcpy: {scrcpy_path}")
                        # Launch detached
                        subprocess.Popen(
                            [scrcpy_path],
                            cwd=os.path.dirname(scrcpy_path),
                            creationflags=subprocess.CREATE_NEW_CONSOLE,
                        )

                        self.send_response(200)
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(b"OK")
                        return
                    else:
                        err = f"Scrcpy not found at {scrcpy_path}"
                else:
                    err = "Server not running on Windows"

                print(f"[Stream] Error: {err}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(err.encode())
            except Exception as e:
                print(f"[Stream] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Input Swipe (Remote Control)
        if self.path.startswith("/api/input/swipe"):
            try:
                # Ensure resolution is detected before calculating coordinates
                if not RESOLUTION_DETECTED:
                    update_device_resolution()

                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                x1 = float(params.get("x1", [0])[0])
                y1 = float(params.get("y1", [0])[0])
                x2 = float(params.get("x2", [0])[0])
                y2 = float(params.get("y2", [0])[0])
                duration = int(params.get("duration", [300])[0])

                real_x1 = int(x1 * DEVICE_WIDTH)
                real_y1 = int(y1 * DEVICE_HEIGHT)
                real_x2 = int(x2 * DEVICE_WIDTH)
                real_y2 = int(y2 * DEVICE_HEIGHT)

                print(
                    f"[Input] Swipe: {real_x1},{real_y1} -> {real_x2},{real_y2} ({duration}ms)"
                )
                cmd = get_adb_base_cmd() + [
                    "shell",
                    "input",
                    "swipe",
                    str(real_x1),
                    str(real_y1),
                    str(real_x2),
                    str(real_y2),
                    str(duration),
                ]

                # Use non-blocking call for better responsiveness
                subprocess.Popen(cmd)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"OK")
            except Exception as e:
                print(f"[Input] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Screen Capture
        if self.path.startswith("/api/capture"):
            try:
                timestamp = int(time.time())
                filename = f"capture_{timestamp}.png"
                capture_dir = os.path.join(WEBROOT, "captures")
                os.makedirs(capture_dir, exist_ok=True)
                filepath = os.path.join(capture_dir, filename)

                print(f"[Capture] Saving to {filepath}")
                cmd = get_adb_base_cmd() + ["exec-out", "screencap", "-p"]

                with open(filepath, "wb") as f:
                    subprocess.run(cmd, stdout=f)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"status": "ok", "url": f"captures/{filename}"}).encode()
                )
            except Exception as e:
                print(f"[Capture] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Keep Awake (Sun Mode)
        if self.path.startswith("/api/device/stayon"):
            try:
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                mode = params.get("mode", ["false"])[0]  # 'true' or 'false'

                print(f"[Power] Stay Awake: {mode}")

                if mode == "true":
                    # Wake up first
                    cmd_wake = get_adb_base_cmd() + [
                        "shell",
                        "input",
                        "keyevent",
                        "224",
                    ]
                    subprocess.run(cmd_wake)
                    # Stay on
                    cmd = get_adb_base_cmd() + [
                        "shell",
                        "svc",
                        "power",
                        "stayon",
                        "true",
                    ]
                else:
                    cmd = get_adb_base_cmd() + [
                        "shell",
                        "svc",
                        "power",
                        "stayon",
                        "false",
                    ]

                subprocess.run(cmd)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"OK")
            except Exception as e:
                print(f"[Power] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle Device Info
        if self.path.startswith("/api/device/info"):
            try:
                # Refresh resolution info
                update_device_resolution()

                cmd = get_adb_base_cmd() + ["shell", "getprop", "ro.product.model"]
                res = subprocess.run(cmd, capture_output=True, text=True)
                model = res.stdout.strip() or "Unknown Device"

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "model": model,
                            "width": DEVICE_WIDTH,
                            "height": DEVICE_HEIGHT,
                            "detected": RESOLUTION_DETECTED,
                        }
                    ).encode()
                )
            except Exception as e:
                print(f"[Info] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Handle PC Launcher (pull bat from device and start)
        if self.path.startswith("/api/pc/launcher/start"):
            try:
                device_ip = self.client_address[0]
                src_url = f"http://{device_ip}:9090/start_miru.bat"

                tmp_dir = os.path.join(MODULE_ROOT, "tmp", "launcher")
                os.makedirs(tmp_dir, exist_ok=True)
                bat_path = os.path.join(tmp_dir, "start_miru.bat")

                ok_fetch = False
                try:
                    import urllib.request

                    with urllib.request.urlopen(src_url, timeout=5) as resp:
                        content = resp.read()
                        if content:
                            with open(bat_path, "wb") as f:
                                f.write(content)
                            ok_fetch = True
                            print(f"[PC] Pulled launcher from {src_url} -> {bat_path}")
                except Exception as e:
                    print(f"[PC] Pull failed from device: {e}")

                if not ok_fetch:
                    local_src = os.path.join(WEBROOT, "start_miru.bat")
                    if os.path.exists(local_src):
                        import shutil

                        shutil.copy(local_src, bat_path)
                        ok_fetch = True
                        print(f"[PC] Fallback copied local {local_src} -> {bat_path}")
                    else:
                        raise RuntimeError("start_miru.bat not available")

                # Launch on Windows (detached)
                if os.name == "nt":
                    subprocess.Popen(
                        ["cmd", "/c", "start", "", bat_path],
                        cwd=tmp_dir,
                        creationflags=subprocess.CREATE_NEW_CONSOLE,
                    )
                else:
                    subprocess.Popen(["bash", bat_path], cwd=tmp_dir)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode())
            except Exception as e:
                print(f"[PC] Launcher error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Stream H.264 (Scrcpy)
        if self.path == "/stream.h264":
            print("[Stream] Request: /stream.h264")
            try:
                if not ensure_scrcpy_server():
                    print("[Stream] Failed to ensure scrcpy server")
                    self.send_error(500, "Failed to start Scrcpy server")
                    return

                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(5)  # 5s connection timeout

                # Retry connection a few times
                connected = False
                for i in range(10):
                    try:
                        s.connect(("127.0.0.1", SCRCPY_PORT))
                        connected = True
                        break
                    except (ConnectionRefusedError, socket.timeout):
                        time.sleep(0.5)

                if not connected:
                    raise ConnectionRefusedError(
                        "Could not connect to Scrcpy socket after retries"
                    )

                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()

                print("[Scrcpy] Client connected to stream")
                s.settimeout(None)  # Remove timeout for streaming

                while True:
                    data = s.recv(32768)  # 32KB buffer
                    if not data:
                        break
                    self.wfile.write(data)
                    self.wfile.flush()  # Force flush

            except (ConnectionResetError, BrokenPipeError):
                print("[Scrcpy] Client disconnected")
            except Exception as e:
                print(f"[Scrcpy] Stream error: {e}")
                # Only send error if headers haven't been sent?
                # Hard to know, but printing is good.
            finally:
                try:
                    s.close()
                except:
                    pass
            return

        # Stream MJPEG
        if self.path.startswith("/stream.mjpeg"):
            self.send_response(200)
            self.send_header(
                "Content-type", "multipart/x-mixed-replace; boundary=--frame"
            )
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()

            try:
                # Optimized Stream Loop
                while True:
                    start_time = time.time()
                    jpeg_bytes = None

                    if HAS_PIL and RESOLUTION_DETECTED:
                        # Fast Path: Raw Capture + PIL JPEG Compression
                        # 'screencap' (raw) is much faster on device than 'screencap -p' (PNG)
                        try:
                            cmd = get_adb_base_cmd() + ["exec-out", "screencap"]
                            process = subprocess.Popen(
                                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                            )
                            # Raw header is 12 bytes: Width(4), Height(4), Format(4)
                            # But we know resolution from RESOLUTION_DETECTED
                            # However, we must read the full stdout
                            raw_data, _ = process.communicate()

                            if raw_data:
                                # Header parsing (Little Endian)
                                w = int.from_bytes(raw_data[0:4], byteorder="little")
                                h = int.from_bytes(raw_data[4:8], byteorder="little")
                                # f = int.from_bytes(raw_data[8:12], byteorder='little') # Format usually 1 (RGBA)

                                pixels = raw_data[12:]

                                # Sanity check
                                expected_len = w * h * 4
                                if len(pixels) >= expected_len:
                                    # Create Image
                                    img = Image.frombytes("RGBA", (w, h), pixels)
                                    # Convert to RGB for JPEG
                                    img_rgb = img.convert("RGB")

                                    # Compress to JPEG (Quality 50 for speed)
                                    with io.BytesIO() as bio:
                                        img_rgb.save(
                                            bio,
                                            format="JPEG",
                                            quality=50,
                                            optimize=False,
                                        )
                                        jpeg_bytes = bio.getvalue()

                        except Exception as e:
                            print(f"[Stream] Raw Capture Failed, falling back: {e}")
                            jpeg_bytes = None

                    if not jpeg_bytes:
                        # Fallback Path: Slow PNG Capture
                        cmd = get_adb_base_cmd() + ["exec-out", "screencap", "-p"]
                        process = subprocess.Popen(
                            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                        )
                        output, _ = process.communicate()
                        if output:
                            jpeg_bytes = (
                                output  # It's actually PNG, but browsers handle it
                            )
                            # Note: Content-Type below says image/jpeg, but browser sniffs magic bytes usually.
                            # To be safe, we should change header if PNG, but let's keep it simple for fallback.

                    if jpeg_bytes:
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n\r\n")
                        self.wfile.write(jpeg_bytes)
                        self.wfile.write(b"\r\n")
                    else:
                        time.sleep(0.5)

                    # Target 30 FPS (approx 0.033s per frame)
                    # But raw transfer takes time, so we just run as fast as possible with minimal sleep
                    elapsed = time.time() - start_time
                    if elapsed < 0.01:
                        time.sleep(0.01)

            except Exception as e:
                print(f"Stream closed: {e}")
            return

        # Redirect root to ide.html
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/ide.html")
            self.end_headers()
            return

        # Pull start_miru.bat from device to PC
        if self.path.startswith("/api/pull_bat"):
            try:
                src = "/data/adb/modules/miru_ui_module/start_miru.bat"
                dst = os.path.join(MODULE_ROOT, "start_miru.bat")
                print(f"[Pull] adb pull {src} -> {dst}")
                res = subprocess.run(
                    get_adb_base_cmd() + ["pull", src, dst],
                    capture_output=True,
                    text=True,
                )
                ok = res.returncode == 0
                stdout = res.stdout
                stderr = res.stderr

                if (not ok) and (
                    "Permission denied" in (stdout or "")
                    or "Permission denied" in (stderr or "")
                ):
                    print("[Pull] Permission denied. Using su cat fallback...")
                    # Fallback: read via su and write locally
                    cat_cmd = get_adb_base_cmd() + [
                        "shell",
                        "su -c 'cat /data/adb/modules/miru_ui_module/start_miru.bat'",
                    ]
                    res2 = subprocess.run(cat_cmd, capture_output=True)
                    if res2.returncode == 0 and res2.stdout:
                        with open(dst, "wb") as f:
                            f.write(res2.stdout)
                        ok = True
                        stdout = "copied via su cat"
                        stderr = (
                            res2.stderr.decode("utf-8", errors="ignore")
                            if res2.stderr
                            else ""
                        )
                    else:
                        ok = False
                        stdout = (
                            res2.stdout.decode("utf-8", errors="ignore")
                            if res2.stdout
                            else stdout
                        )
                        stderr = (
                            res2.stderr.decode("utf-8", errors="ignore")
                            if res2.stderr
                            else stderr
                        )
                self.send_response(200 if ok else 500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-type", "application/json")
                self.end_headers()
                payload = {
                    "status": "ok" if ok else "error",
                    "stdout": stdout,
                    "stderr": stderr,
                }
                self.wfile.write(json.dumps(payload).encode())
            except Exception as e:
                print(f"[Pull] Error: {e}")
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        # Serve static files from webroot
        super().do_GET()

    # Merged into first do_POST


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    print(f"========================================")
    print(f"   Miru Host Server (WebUI + Stream)")
    print(f"========================================")
    print(f"[*] Root: {WEBROOT}")
    print(f"[*] URL:  http://localhost:{PORT}/ide.html")
    print(f"[*] Stream: http://localhost:{PORT}/stream.mjpeg")

    # Check ADB
    try:
        subprocess.check_call(["adb", "start-server"])
    except:
        print("[!] Warning: ADB not found")

    with ThreadingHTTPServer(("", PORT), MiruHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Stopping server...")
