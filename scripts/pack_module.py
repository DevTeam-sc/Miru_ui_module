import os
import zipfile
import shutil
from datetime import datetime

def is_unix_text_file(filename):
    """Check if file should be converted to LF line endings"""
    # Check extension
    if filename.endswith('.sh') or filename.endswith('.prop'):
        return True
    # Check specific filenames (no extension)
    if os.path.basename(filename) in ['miru']:
        return True
    return False

def pack_module():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    module_name = f"Miru_UI_Module_v5.1_Build_{timestamp}"
    zip_filename = f"{module_name}.zip"
    
    # Files/Dirs to include
    includes = [
        "module.prop",
        "service.sh",
        "action.sh",
        "system",
        "webroot",
        "scripts",
        "start_miru.bat",
        "miru.bat",
    ]
    
    print(f"Creating {zip_filename}...")
    
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        
        def add_file_to_zip(fs_path, arc_path):
            """Add file to zip, converting CRLF to LF for Unix scripts"""
            # Normalize arc_path to use forward slashes (standard for zip)
            arc_path = arc_path.replace(os.sep, '/')
            
            if is_unix_text_file(fs_path):
                try:
                    with open(fs_path, 'rb') as f:
                        content = f.read()
                    # Convert CRLF to LF
                    if b'\r\n' in content:
                        print(f"  [LF Fix] Converting {arc_path}")
                        content = content.replace(b'\r\n', b'\n')
                    zipf.writestr(arc_path, content)
                except Exception as e:
                    print(f"  [Error] Failed to convert {fs_path}: {e}")
                    zipf.write(fs_path, arc_path)
            else:
                zipf.write(fs_path, arc_path)

        for item in includes:
            if os.path.isfile(item):
                add_file_to_zip(item, item)
            elif os.path.isdir(item):
                for root, dirs, files in os.walk(item):
                    # Skip __pycache__ and hidden files
                    files = [f for f in files if not f.startswith('.')]
                    dirs[:] = [d for d in dirs if not d.startswith('.')]
                    
                    for file in files:
                        file_path = os.path.join(root, file)
                        add_file_to_zip(file_path, file_path)
        
        # Add scrcpy-server.jar
        scrcpy_src = os.path.join("tools", "scrcpy", "scrcpy-win64-v2.4", "scrcpy-server")
        if os.path.exists(scrcpy_src):
            zipf.write(scrcpy_src, "tools/scrcpy-server.jar")
            print("Included scrcpy-server.jar")
        else:
            print("Warning: scrcpy-server.jar not found, skipping.")

        # Add ADB Binaries
        adb_dir = os.path.join("tools", "scrcpy", "scrcpy-win64-v2.4")
        adb_files = ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"]
        for f in adb_files:
            src = os.path.join(adb_dir, f)
            if os.path.exists(src):
                zipf.write(src, f"tools/adb/{f}")
                print(f"Included {f}")
        
        # Add Python (Embeddable)
        py_dir = os.path.join("tools", "python")
        if os.path.exists(py_dir):
            for root, dirs, files in os.walk(py_dir):
                files = [f for f in files if not f.startswith('.')]
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = file_path.replace("\\", "/") 
                    zipf.write(file_path, arcname)
            print("Included Embedded Python")

    print(f"Done! {zip_filename} created.")

if __name__ == "__main__":
    pack_module()
