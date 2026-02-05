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


# 3. Copy ADB Binaries (If we shipped them)
# We need to ensure these are in the module first!
ADB_SRC="$MOD_PATH/tools/adb"

if [ -d "$ADB_SRC" ]; then
    # Copy essential ADB files only
    cp "$ADB_SRC/adb.exe" "$TARGET_DIR/" 2>/dev/null
    cp "$ADB_SRC/AdbWinApi.dll" "$TARGET_DIR/" 2>/dev/null
    cp "$ADB_SRC/AdbWinUsbApi.dll" "$TARGET_DIR/" 2>/dev/null
    echo "[Miru] ADB binaries copied."
else
    # Fallback to legacy path if present
    LEGACY_ADB="$MOD_PATH/tools/scrcpy/scrcpy-win64-v2.4"
    if [ -d "$LEGACY_ADB" ]; then
        cp "$LEGACY_ADB/adb.exe" "$TARGET_DIR/" 2>/dev/null
        cp "$LEGACY_ADB/AdbWinApi.dll" "$TARGET_DIR/" 2>/dev/null
        cp "$LEGACY_ADB/AdbWinUsbApi.dll" "$TARGET_DIR/" 2>/dev/null
        echo "[Miru] ADB binaries copied (Legacy)."
    else
        echo "[Miru] Warning: ADB tools not found at $ADB_SRC"
    fi
fi

# 4. Copy Bundled Python (If we shipped it)
PY_SRC="$MOD_PATH/tools/python"
if [ -f "$PY_SRC/python.exe" ]; then
    echo "[Miru] Copying bundled Python..."
    mkdir -p "$TARGET_DIR/tools/python"
    cp -r "$PY_SRC/"* "$TARGET_DIR/tools/python/"
fi

echo "[Miru] Portable Launcher Ready!"
echo "[Info] You can now plug this device into any PC, open '$TARGET_DIR', and run start_miru.bat"
