@echo off
echo [Miru] Checking device connection...
adb wait-for-device
echo [Miru] Device found! Re-establishing Tunnel...
adb forward tcp:9090 tcp:9090
echo [Miru] Success! Try refreshing the browser now.
timeout /t 3
