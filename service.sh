#!/system/bin/sh
# Robust module dir detection
MODDIR=${0%/*}
SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
if [ -z "$MODDIR" ] || [ "$MODDIR" = "." ]; then
    case "$SELF" in
        /*)
            MODDIR=${SELF%/*}
            ;;
        *)
            if [ -d "/data/adb/ksu/modules/miru_ui_module" ]; then
                MODDIR="/data/adb/ksu/modules/miru_ui_module"
            elif [ -d "/data/adb/modules/miru_ui_module" ]; then
                MODDIR="/data/adb/modules/miru_ui_module"
            else
                MODDIR="/data/adb/modules/Miruko_bypass2"
            fi
            ;;
    esac
fi
LOG=/data/local/tmp/miru_ui_module.log

# Log boot
echo "==================================" >> "$LOG"
echo "[Miru] Service started at $(date)" >> "$LOG"

# Wait for boot completion
until [ "$(getprop sys.boot_completed)" = "1" ]; do
    sleep 2
done

echo "[Miru] Boot completed. Starting WebUI..." >> "$LOG"

# Export MODDIR for child scripts
export MODDIR="$MODDIR"

# Execute Server Script
SERVER_SCRIPT="$MODDIR/system/bin/httpd_server.sh"

# Refresh Portable Launcher (SD Card)
LAUNCHER_SETUP="$MODDIR/scripts/setup_launcher.sh"
if [ -f "$LAUNCHER_SETUP" ]; then
    chmod +x "$LAUNCHER_SETUP"
    sh "$LAUNCHER_SETUP" >> "$LOG" 2>&1
    echo "[Miru] Launcher setup executed." >> "$LOG"
fi

if [ -f "$SERVER_SCRIPT" ]; then
    chmod +x "$SERVER_SCRIPT"
    sh "$SERVER_SCRIPT" >> "$LOG" 2>&1
    echo "[Miru] Server script executed with exit code $?" >> "$LOG"
else
    echo "[Miru] ❌ Error: Server script not found at $SERVER_SCRIPT" >> "$LOG"
fi
