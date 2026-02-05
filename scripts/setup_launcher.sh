#!/system/bin/sh
# setup_launcher.sh - Installs Miru Launcher to SD Card

# Robust module dir detection
MOD_PATH=${0%/*}
SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
if [ -z "$MOD_PATH" ] || [ "$MOD_PATH" = "." ]; then
    case "$SELF" in
        /*)
            MOD_PATH=${SELF%/*}
            ;;
        *)
            MOD_PATH="/data/adb/modules/miru_ui_module"
            ;;
    esac
fi
# Fix path if we are in scripts/ subdir
case "$MOD_PATH" in
    */scripts)
        MOD_PATH=${MOD_PATH%/*}
        ;;
esac

TARGET_DIR="/sdcard/Miru_Toolbox"

echo "[Miru] Setting up Portable Launcher in $TARGET_DIR..."

# 1. Create Directory
mkdir -p "$TARGET_DIR"

# 2. Copy Launcher Script (The .bat files)
# We assume start_miru.bat is inside the module root or webroot
if [ -f "$MOD_PATH/webroot/start_miru.bat" ]; then
    cp "$MOD_PATH/webroot/start_miru.bat" "$TARGET_DIR/"
elif [ -f "$MOD_PATH/start_miru.bat" ]; then
    cp "$MOD_PATH/start_miru.bat" "$TARGET_DIR/"
else
    # Fallback: create a minimal one if missing
    echo "@echo off" > "$TARGET_DIR/start_miru.bat"
    echo "echo [Error] Original start_miru.bat not found in module." >> "$TARGET_DIR/start_miru.bat"
    echo "pause" >> "$TARGET_DIR/start_miru.bat"
fi

# Copy CLI wrapper if exists
if [ -f "$MOD_PATH/miru.bat" ]; then
    cp "$MOD_PATH/miru.bat" "$TARGET_DIR/"
fi


# 3. Copy Tools (ADB, Python, Scrcpy) - Full Structure
TOOLS_SRC="$MOD_PATH/tools"

echo "[Miru] Syncing Module to SD Card (All-in-One)..."

# 3.1 Copy Tools
if [ -d "$TOOLS_SRC" ]; then
    mkdir -p "$TARGET_DIR/tools"
    cp -rf "$TOOLS_SRC/"* "$TARGET_DIR/tools/"
else
    echo "[Miru] Warning: 'tools/' not found."
fi

# 3.2 Copy Scripts & Webroot (For offline PC setup)
if [ -d "$MOD_PATH/scripts" ]; then
    mkdir -p "$TARGET_DIR/scripts"
    cp -rf "$MOD_PATH/scripts/"* "$TARGET_DIR/scripts/"
fi

if [ -d "$MOD_PATH/webroot" ]; then
    mkdir -p "$TARGET_DIR/webroot"
    cp -rf "$MOD_PATH/webroot/"* "$TARGET_DIR/webroot/"
fi

# 3.3 Copy System Binaries (Optional, for reference)
if [ -d "$MOD_PATH/system/bin" ]; then
    mkdir -p "$TARGET_DIR/system/bin"
    cp -rf "$MOD_PATH/system/bin/"* "$TARGET_DIR/system/bin/"
fi

# 4. Copy ADB to root for convenience (Optional)
if [ -f "$TARGET_DIR/tools/scrcpy/scrcpy-win64-v2.4/adb.exe" ]; then
    cp "$TARGET_DIR/tools/scrcpy/scrcpy-win64-v2.4/adb.exe" "$TARGET_DIR/" 2>/dev/null
    cp "$TARGET_DIR/tools/scrcpy/scrcpy-win64-v2.4/AdbWinApi.dll" "$TARGET_DIR/" 2>/dev/null
    cp "$TARGET_DIR/tools/scrcpy/scrcpy-win64-v2.4/AdbWinUsbApi.dll" "$TARGET_DIR/" 2>/dev/null
elif [ -f "$TARGET_DIR/tools/adb/adb.exe" ]; then
    cp "$TARGET_DIR/tools/adb/adb.exe" "$TARGET_DIR/" 2>/dev/null
fi

echo "[Miru] Portable Launcher Ready!"
echo "[Info] You can now plug this device into any PC, open '$TARGET_DIR', and run start_miru.bat"
