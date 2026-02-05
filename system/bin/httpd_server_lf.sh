#!/system/bin/sh
# Miru Web Server

# Find Mod Directory (if not provided, guess standard path)
if [ -z "$MODDIR" ]; then
    # Try to find self location first
    SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
    MODDIR="${SELF%/system/bin/*}"
    
    if [ ! -d "$MODDIR/webroot" ]; then
        # Check KSU path
        if [ -d "/data/adb/ksu/modules/miru_ui_module" ]; then
            MODDIR="/data/adb/ksu/modules/miru_ui_module"
            # Check Magisk path
            elif [ -d "/data/adb/modules/miru_ui_module" ]; then
            MODDIR="/data/adb/modules/miru_ui_module"
        else
            # Fallback legacy
            MODDIR="/data/adb/modules/Miruko_bypass2"
        fi
    fi
fi

WEBROOT="$MODDIR/webroot"
PORT=9090

# Find Busybox
if [ -x "/data/adb/magisk/busybox" ]; then
    BB="/data/adb/magisk/busybox"
    elif [ -x "/data/adb/ksu/bin/busybox" ]; then
    BB="/data/adb/ksu/bin/busybox"
    elif [ -x "/system/bin/busybox" ]; then
    BB="/system/bin/busybox"
    elif [ -x "/system/xbin/busybox" ]; then
    BB="/system/xbin/busybox"
    elif command -v busybox >/dev/null 2>&1; then
    BB="busybox"
else
    echo "❌ Busybox not found! WebUI cannot start."
    exit 1
fi

# 1. Kill existing instance
# We match the port to avoid killing other httpd services
pkill -f "httpd -p $PORT" || $BB pkill -f "httpd -p $PORT"

# 2. Fix Permissions for CGI
# Critical: CGI script must be executable
if [ -d "$WEBROOT/cgi-bin" ]; then
    chmod -R 755 "$WEBROOT/cgi-bin"
fi

# 3. Start Server
# -p: Port
# -h: Home (Root)
# -c: Config file (optional)
# By default, it daemonizes.
echo "🚀 Starting Web Server with $BB..."
$BB httpd -p $PORT -h "$WEBROOT"

if [ $? -eq 0 ]; then
    echo "Miru Web Bridge started on port $PORT"
    echo "Access at: http://<DEVICE_IP>:$PORT"
else
    echo "❌ Failed to start Web Server"
fi
