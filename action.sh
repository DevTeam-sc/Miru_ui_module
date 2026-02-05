#!/system/bin/sh

# 0. Robust Module Directory Detection (Absolute Paths First)
if [ -d "/data/adb/modules/miru_ui_module" ]; then
    MODDIR="/data/adb/modules/miru_ui_module"
elif [ -d "/data/adb/ksu/modules/miru_ui_module" ]; then
    MODDIR="/data/adb/ksu/modules/miru_ui_module"
else
    # Fallback to relative path resolution
    MODDIR=${0%/*}
    if [ "$MODDIR" = "." ]; then
        MODDIR=$(pwd)
    fi
fi

LOG=/data/local/tmp/miru_ui_module.log

# Helper function
log_msg() {
    echo "$1"
    echo "$1" >> "$LOG" 2>/dev/null
}

log_msg "=================================="
log_msg "[Miru] Action Button Pressed at $(date)"
log_msg "[Debug] Resolved MODDIR: $MODDIR"

# 1. Check if running (Smart Mode)
log_msg "[Step 1] Checking status..."
PID=$(ps -ef | grep "httpd -p 9090" | grep -v grep | awk '{print $2}')

if [ -n "$PID" ]; then
    log_msg "[Miru] Server is ALREADY RUNNING (PID: $PID). No restart needed."
else
    log_msg "[Miru] Server NOT running. Starting now..."
    # 2. Start Server
    SERVER_SCRIPT="$MODDIR/system/bin/httpd_server.sh"
    if [ -f "$SERVER_SCRIPT" ]; then
        chmod +x "$SERVER_SCRIPT"
        log_msg "[Step 2] Starting Web Server..."
        
        # Run the server script
        export MODDIR="$MODDIR"
        sh "$SERVER_SCRIPT" >> "$LOG" 2>&1 &
        sleep 1
        log_msg "[Miru] Server start command issued."
    else
        log_msg "[Error] Server script not found at $SERVER_SCRIPT"
    fi
fi

# 3. Open Browser
log_msg "[Step 3] Opening WebUI..."
am start -a android.intent.action.VIEW -d "http://localhost:9090/ide.html" >/dev/null 2>&1

# 3. Refresh Launcher (SD Card)
LAUNCHER_SETUP="$MODDIR/scripts/setup_launcher.sh"
if [ -f "$LAUNCHER_SETUP" ]; then
    chmod +x "$LAUNCHER_SETUP"
    log_msg "[Step 3] Updating Portable Launcher..."
    sh "$LAUNCHER_SETUP" >> "$LOG" 2>&1
fi

# 4. Trigger PC batch file copy (If config exists)
HOST_JSON="$MODDIR/webroot/config/host.json"
if [ -f "$HOST_JSON" ]; then
    HOST=$(cat "$HOST_JSON" | tr -d '\r\n ' | sed -n 's/.*\"host\"\s*:\s*\"\([^\"]*\)\".*/\1/p')
    if [ -n "$HOST" ]; then
        log_msg "[Step 4] Triggering PC Batch Copy at $HOST"
        # Background this so it doesn't block
        (
            sleep 1
            if command -v curl >/dev/null 2>&1; then
                curl -s "$HOST/api/pull_bat" >/dev/null 2>&1
            elif command -v wget >/dev/null 2>&1; then
                wget -q -O - "$HOST/api/pull_bat" >/dev/null 2>&1
            else
                /system/bin/wget -q -O - "$HOST/api/pull_bat" >/dev/null 2>&1 || true
            fi
        ) &
    fi
fi

log_msg "[Miru] Action Complete."

# 5. Notify User
cmd notification post -S bigtext -t "Miru Module" "Action Completed!" "WebUI: http://localhost:9090" >/dev/null 2>&1
log_msg "[Done] WebUI Ready at http://localhost:9090"
