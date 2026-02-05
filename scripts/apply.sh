#!/system/bin/sh
CFG="/data/adb/miru_ui_module/config.json"
enabled="$1"
level="$2"
mkdir -p /data/adb/miru_ui_module
cat > "$CFG" <<EOF
{"enabled":$enabled,"level":$level}
EOF
echo "OK"
