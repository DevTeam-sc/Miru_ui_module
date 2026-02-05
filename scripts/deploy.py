import subprocess
import sys
import os
import socket
import json

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('8.8.8.8', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def generate_host_config():
    ip = get_local_ip()
    port = 8000
    host_url = f"http://{ip}:{port}"
    print(f"[Miru] Auto-detected Host IP: {host_url}")
    
    config_path = os.path.join("webroot", "config", "host.json")
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    
    with open(config_path, "w") as f:
        json.dump({"host": host_url}, f)

def get_adb_base_cmd():
    try:
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        lines = res.stdout.strip().split('\n')[1:]
        devices = [line.split()[0] for line in lines if line.strip() and "device" in line]
        
        if len(devices) == 0:
            print("[Error] No device found.")
            sys.exit(1)
        if len(devices) == 1:
            return ["adb"]
        
        print(f"[Info] Multiple devices found: {devices}")
        print(f"[Info] Selecting first device: {devices[0]}")
        return ["adb", "-s", devices[0]]
    except Exception as e:
        print(f"[Error] ADB check failed: {e}")
        sys.exit(1)

def run_adb(args):
    cmd = get_adb_base_cmd() + args
    print(f"[Exec] {' '.join(cmd)}")
    subprocess.check_call(cmd)

def main():
    print("[Miru] Smart Deployer")
    
    # 0. Generate Host Config
    generate_host_config()
    
    # 1. Create temp dir
    run_adb(["shell", "mkdir -p /data/local/tmp/miru_sync"])
    
    # 2. Push Root Files (module.prop, service.sh, action.sh, start_miru.bat)
    print("[Miru] Syncing root files...")
    for f in ["module.prop", "service.sh", "action.sh", "start_miru.bat"]:
        if os.path.exists(f):
            run_adb(["push", f, f"/data/local/tmp/miru_sync/{f}"])
    
    # 3. Push Directories
    print("[Miru] Syncing directories...")
    for d in ["scripts", "webroot", "system"]:
        if os.path.exists(d):
            run_adb(["push", d, f"/data/local/tmp/miru_sync/{d}"])

    # 4. Handle Tools (Scrcpy & ADB)
    # Match pack_module.py behavior: flatten scrcpy-server to tools/scrcpy-server.jar
    print("[Miru] Syncing tools...")
    run_adb(["shell", "mkdir -p /data/local/tmp/miru_sync/tools"])
    
    # Scrcpy Server
    scrcpy_src = os.path.join("tools", "scrcpy", "scrcpy-win64-v2.4", "scrcpy-server")
    if os.path.exists(scrcpy_src):
        run_adb(["push", scrcpy_src, "/data/local/tmp/miru_sync/tools/scrcpy-server.jar"])
        
    # ADB Binaries (for Portable Launcher)
    adb_dir = os.path.join("tools", "scrcpy", "scrcpy-win64-v2.4")
    adb_files = ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"]
    run_adb(["shell", "mkdir -p /data/local/tmp/miru_sync/tools/adb"])
    
    for f in adb_files:
        src = os.path.join(adb_dir, f)
        if os.path.exists(src):
             run_adb(["push", src, f"/data/local/tmp/miru_sync/tools/adb/{f}"])

    
    # 5. Install to Module Dir (Root Access Required)
    print("[Miru] Installing to module directory...")
    # Ensure base dir exists
    run_adb(["shell", "su -c 'mkdir -p /data/adb/modules/miru_ui_module'"])
    
    # Copy all from temp to module
    # We use cp -rf to overwrite
    run_adb(["shell", "su -c 'cp -rf /data/local/tmp/miru_sync/* /data/adb/modules/miru_ui_module/'"])
    
    # Fix Permissions
    run_adb(["shell", "su -c 'chmod -R 755 /data/adb/modules/miru_ui_module/scripts'"])
    run_adb(["shell", "su -c 'chmod -R 755 /data/adb/modules/miru_ui_module/system'"])
    run_adb(["shell", "su -c 'chmod 755 /data/adb/modules/miru_ui_module/service.sh'"])
    run_adb(["shell", "su -c 'chmod 755 /data/adb/modules/miru_ui_module/action.sh'"])
    
    # 6. Cleanup
    run_adb(["shell", "rm -rf /data/local/tmp/miru_sync"])
    
    print("[Miru] Deploy Complete.")

if __name__ == "__main__":
    main()
