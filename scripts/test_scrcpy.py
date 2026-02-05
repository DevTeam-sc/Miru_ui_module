import socket
import struct
import subprocess
import time
import os
import sys

# Config
ADB_PATH = "adb" # Assume in path or use full path
SERVER_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "scrcpy", "scrcpy-win64-v2.4", "scrcpy-server")
DEVICE_SERVER_PATH = "/data/local/tmp/scrcpy-server.jar"
SOCKET_NAME = "scrcpy"
PORT = 27183

def get_adb_cmd():
    return ["adb", "-s", "R92X70K8D9N"]

def push_server():
    print(f"[Setup] Pushing {SERVER_FILE_PATH} to {DEVICE_SERVER_PATH}...")
    subprocess.run(get_adb_cmd() + ["push", SERVER_FILE_PATH, DEVICE_SERVER_PATH], check=True)

def enable_forward():
    print(f"[Setup] Forwarding tcp:{PORT} -> localabstract:{SOCKET_NAME}...")
    subprocess.run(get_adb_cmd() + ["forward", f"tcp:{PORT}", f"localabstract:{SOCKET_NAME}"], check=True)

def run_server():
    print("[Setup] Starting Scrcpy Server...")
    # Arguments for Scrcpy 2.4 (guessed based on standard usage)
    # Order and format is critical.
    # Scrcpy 2.x uses key=value
    
    cmd = get_adb_cmd() + [
        "shell",
        "CLASSPATH=" + DEVICE_SERVER_PATH,
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        "2.4", # Version must be first arg usually
        "log_level=verbose",
        "tunnel_forward=true",
        "video=true",
        "audio=false",
        "control=false", # We only want to watch for now
        "send_device_meta=false",
        "send_frame_meta=false",
        "send_dummy_byte=false",
        "send_codec_meta=false", # Add this too just in case
        "raw_stream=true" # Ensure we get raw stream
    ]
    
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def read_stream():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        print(f"[Stream] Connecting to localhost:{PORT}...")
        # Retry connection as server takes time to start
        for i in range(10):
            try:
                s.connect(("127.0.0.1", PORT))
                break
            except ConnectionRefusedError:
                time.sleep(0.5)
        else:
            print("[Error] Could not connect to scrcpy socket")
            return

        print("[Stream] Connected!")
        
        # DEBUG: Dump first 256 bytes
        raw_dump = s.recv(256)
        print(f"[Debug] First 256 bytes:\n{raw_dump.hex()}")
        return

            
    except KeyboardInterrupt:
        print("Stopped")
    finally:
        s.close()

if __name__ == "__main__":
    try:
        push_server()
        enable_forward()
        proc = run_server()
        
        # Give it a sec to start
        time.sleep(1)
        
        # Check if process died
        if proc.poll() is not None:
            print(f"[Error] Server exited immediately. Code: {proc.returncode}")
            print("Stderr:", proc.stderr.read().decode())
        else:
            read_stream()
            proc.terminate()
            
    except Exception as e:
        print(f"[Error] {e}")
