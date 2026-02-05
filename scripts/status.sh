#!/system/bin/sh
CFG="/data/adb/miru_ui_module/config.json"
if [ ! -f "$CFG" ]; then
  echo '{"enabled":false,"level":1}'
  exit 0
fi
cat "$CFG"
