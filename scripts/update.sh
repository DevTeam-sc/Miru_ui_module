#!/system/bin/sh
# Miru Update Script (Hot Update from Git)

# 1. Config
# URL of the repository ZIP file (Master/Main branch)
# Replace this with your actual repository URL
REPO_URL="https://github.com/DevTeam-sc/Miru_ui_module/archive/refs/heads/main.zip"
UPDATE_DIR="/data/local/tmp/miru_update"
MOD_DIR="/data/adb/modules/miru_ui_module"

# KSU Path Check
if [ -d "/data/adb/ksu/modules/miru_ui_module" ]; then
    MOD_DIR="/data/adb/ksu/modules/miru_ui_module"
fi

echo "[*] Starting Update Process..."
echo "[*] Target: $MOD_DIR"

# 2. Check Tools
if ! command -v curl >/dev/null 2>&1; then
    echo "❌ Error: 'curl' not found. Please install curl."
    exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
    echo "❌ Error: 'unzip' not found. Please install unzip."
    exit 1
fi

# 3. Download
echo "[*] Downloading update from Git..."
rm -rf "$UPDATE_DIR"
mkdir -p "$UPDATE_DIR"

if curl -L -o "$UPDATE_DIR/update.zip" "$REPO_URL"; then
    echo "[+] Download success"
else
    echo "❌ Download failed"
    exit 1
fi

# 4. Extract
echo "[*] Extracting..."
unzip -o "$UPDATE_DIR/update.zip" -d "$UPDATE_DIR/extracted" >/dev/null 2>&1

# Find the inner folder (usually repo-name-main)
INNER_DIR=$(find "$UPDATE_DIR/extracted" -maxdepth 1 -type d | tail -n 1)

if [ -z "$INNER_DIR" ]; then
    echo "❌ Extraction failed or empty zip"
    exit 1
fi

echo "[*] Found content at: $INNER_DIR"

# 5. Install Updates (Hot Swap)
# We only update webroot and scripts to avoid breaking the module props or binaries
echo "[*] Updating files..."

# Backup config if exists
cp "$MOD_DIR/webroot/config/host.json" "$UPDATE_DIR/host.json.bak" 2>/dev/null

# Copy Webroot
cp -Rf "$INNER_DIR/webroot/"* "$MOD_DIR/webroot/"
# Copy Scripts
cp -Rf "$INNER_DIR/scripts/"* "$MOD_DIR/scripts/"

# Restore config
if [ -f "$UPDATE_DIR/host.json.bak" ]; then
    cp "$UPDATE_DIR/host.json.bak" "$MOD_DIR/webroot/config/host.json"
fi

# 6. Set Permissions
chmod -R 755 "$MOD_DIR/scripts"
chmod -R 755 "$MOD_DIR/webroot/cgi-bin"

# 7. Cleanup
rm -rf "$UPDATE_DIR"

echo "✅ Update Complete! Refresh the page."
