#!/system/bin/sh
# Miru Hook Runner
PKG="$1"
SCRIPT="$2"
LOG="/dev/stdout"

timestamp() {
    date '+%H:%M:%S'
}

# 0. Safety First: Kill stale injectors
# This prevents "Address already in use" or ptrace conflicts that cause reboots
killall frida-inject 2>/dev/null
pkill -f frida-inject 2>/dev/null

echo "[$(timestamp)] [Miru] 🚀 Launching Hook for: $PKG" >> "$LOG"

# 1. Verify Inputs
if [ -z "$PKG" ] || [ -z "$SCRIPT" ]; then
    echo "[$(timestamp)] [Error] Missing arguments: run_miru.sh <pkg> <script>" >> "$LOG"
    exit 1
fi

if [ ! -f "$SCRIPT" ]; then
    echo "[$(timestamp)] [Error] Script file not found: $SCRIPT" >> "$LOG"
    exit 1
fi

# 2. Clean State
# ide.html handles log truncation and directory creation

am force-stop "$PKG"
# Clear logcat buffer to avoid noise
logcat -c

# 3. Launch App
# Use monkey to launch safely (works with most activities)
echo "[$(timestamp)] [Miru] Launching app..." >> "$LOG"
monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

# 4. Inject Frida
echo "[$(timestamp)] [Miru] Injecting Frida..." >> "$LOG"
# Use frida-inject directly
# Note: Ensure frida-inject is in path or use full path. 
# We assume it's in /data/local/tmp/frida-inject or /system/bin/frida-inject
# But wait, usually we use a specific path. 
# Let's try finding it or assuming standard location.
# For this environment, let's assume /data/local/tmp/frida-inject exists? 
# Or relies on user having it.
# Actually, the previous code didn't specify injection logic?
# Wait, let me check the original run_miru.sh content I replaced.
# The original content was VERY short. It didn't have the injection logic!
# It just had:
# echo ...
# am force-stop ...
# 
# WHERE is the injection logic??
# Ah, I might have overwritten the injection logic with my previous "Clean State" replacement!
# Let me check what I replaced.
# I replaced:
# # 2. Clean State (and Log)
# ...
# mkdir -p ...
#
# with:
# # 2. Clean State
# # ide.html handles ...
# am force-stop "$PKG"
#
# But where is the rest of the file?
# The original file (from my memory or search) should have had the injection command.
# Let's look at the file content again.
