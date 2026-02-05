@echo off
setlocal EnableDelayedExpansion
title Miru UI Module - Starter

:: --- 0. Launcher Mode Check (Run from SD/MTP) ---
:: If 'scripts' folder is missing, we assume we are in "Launcher Mode" (e.g. copied from SD Card)
if not exist "%~dp0scripts\web_stream.py" (
    echo [Miru] Launcher Mode Detected!
    echo [Miru] I will now pull the latest Brain from the device...
    
    :: 1. Setup Temp Workspace
    set "WORK_DIR=%TEMP%\Miru_Session_%RANDOM%"
    mkdir "!WORK_DIR!"
    echo [Info] Workspace: !WORK_DIR!
    
    :: 2. Find ADB (Expect it next to script)
    if exist "%~dp0adb.exe" (
        set "PATH=%~dp0;%PATH%"
    ) else (
        :: Try standard paths
        where adb >nul 2>&1
        if !errorlevel! neq 0 (
            echo [Error] ADB not found! Please keep adb.exe next to this script.
            pause
            exit /b 1
        )
    )
    
    :: 3. Connect & Pull
    echo [Miru] Connecting to device...
    adb devices
    
    echo [Miru] Pulling Module Files...
    :: We assume standard module path. If you renamed the module, change this!
    set "MOD_PATH=/data/adb/modules/miru_ui_module"
    
    adb pull "!MOD_PATH!/scripts" "!WORK_DIR!\scripts"
    adb pull "!MOD_PATH!/webroot" "!WORK_DIR!\webroot"
    adb pull "!MOD_PATH!/system/bin" "!WORK_DIR!\system\bin"
    
    :: Check if pull succeeded
    if not exist "!WORK_DIR!\scripts\web_stream.py" (
        echo [Error] Failed to pull files. Is the module installed on the device?
        pause
        exit /b 1
    )
    
    :: 4. Handover
    echo [Miru] Launching Session...
    cd /d "!WORK_DIR!"
    
    :: Create a dummy batch to chain execution without recursion loop
    echo @echo off > launch_me.bat
    echo call scripts\..\start_miru.bat >> launch_me.bat
    
    :: We need to copy start_miru.bat itself if it wasn't pulled (it might not be in the module folder depending on structure)
    :: But usually we ship it. If not, copy from current location
    copy "%~dp0%~nx0" "!WORK_DIR!\start_miru.bat" >nul
    
    :: Execute from new home
    start_miru.bat
    exit /b
)

:: --- 1. Environment Setup ---
echo [Miru] Initializing Environment...

:: Add bundled ADB to PATH
set "TOOLS_DIR=%~dp0tools\scrcpy\scrcpy-win64-v2.4"
if exist "%TOOLS_DIR%\adb.exe" (
    echo [Miru] Using bundled ADB: %TOOLS_DIR%
    set "PATH=%TOOLS_DIR%;%PATH%"
)

:: Check for ADB in tools/adb (Portable Mode)
if exist "%~dp0tools\adb\adb.exe" (
    echo [Miru] Using Portable ADB: %~dp0tools\adb
    set "PATH=%~dp0tools\adb;%PATH%"
)

:: Check for Bundled Python
set "PYTHON_CMD=python"
if exist "%~dp0tools\python\python.exe" (
    echo [Miru] Using bundled Python...
    set "PYTHON_CMD=%~dp0tools\python\python.exe"
)

:: Check ADB
adb devices >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] ADB not found or not working.
    pause
    exit /b 1
)

:: Auto-Select Device
set "ADB_CMD=adb"
for /f "skip=1 tokens=1" %%a in ('adb devices') do (
    if "%%a" neq "List" (
        set "DEVICE_SERIAL=%%a"
        goto :FoundDevice
    )
)
:FoundDevice
if defined DEVICE_SERIAL (
    echo [Miru] Target Device: !DEVICE_SERIAL!
    set "ADB_CMD=adb -s !DEVICE_SERIAL!"
    set "ANDROID_SERIAL=!DEVICE_SERIAL!"
) else (
    echo [Error] No device connected!
    pause
    exit /b 1
)

:: --- 2. Smart Deploy (Native Batch/PowerShell) ---
echo [Miru] Generating Host Config...
powershell -Command "$ip = (Test-Connection -ComputerName (hostname) -Count 1).IPV4Address.IPAddressToString; $json = '{\"host\": \"http://' + $ip + ':8000\"}'; Set-Content -Path 'webroot\config\host.json' -Value $json -Encoding UTF8"

echo [Miru] Syncing files to device...
:: Create temp dir
!ADB_CMD! shell "mkdir -p /data/local/tmp/miru_sync"

:: Push Scripts & Webroot & Tools
echo [Sync] Pushing scripts...
!ADB_CMD! push scripts /data/local/tmp/miru_sync/ >nul
echo [Sync] Pushing webroot...
!ADB_CMD! push webroot /data/local/tmp/miru_sync/ >nul
echo [Sync] Pushing tools...
!ADB_CMD! push tools /data/local/tmp/miru_sync/ >nul

:: Push Root Files
echo [Sync] Pushing root files...
!ADB_CMD! push action.sh /data/local/tmp/miru_sync/ >nul
!ADB_CMD! push service.sh /data/local/tmp/miru_sync/ >nul
!ADB_CMD! push start_miru.bat /data/local/tmp/miru_sync/ >nul
!ADB_CMD! push module.prop /data/local/tmp/miru_sync/ >nul
!ADB_CMD! push system /data/local/tmp/miru_sync/ >nul

:: Move to Module Dir (Root required)
echo [Sync] Installing to /data/adb/modules...
!ADB_CMD! shell "su -c 'mkdir -p /data/adb/modules/miru_ui_module/scripts && cp -rf /data/local/tmp/miru_sync/scripts/* /data/adb/modules/miru_ui_module/scripts/'"
!ADB_CMD! shell "su -c 'mkdir -p /data/adb/modules/miru_ui_module/webroot && cp -rf /data/local/tmp/miru_sync/webroot/* /data/adb/modules/miru_ui_module/webroot/'"
!ADB_CMD! shell "su -c 'mkdir -p /data/adb/modules/miru_ui_module/tools && cp -rf /data/local/tmp/miru_sync/tools/* /data/adb/modules/miru_ui_module/tools/'"
!ADB_CMD! shell "su -c 'mkdir -p /data/adb/modules/miru_ui_module/system && cp -rf /data/local/tmp/miru_sync/system/* /data/adb/modules/miru_ui_module/system/'"

:: Install Root Files
!ADB_CMD! shell "su -c 'cp -f /data/local/tmp/miru_sync/action.sh /data/adb/modules/miru_ui_module/'"
!ADB_CMD! shell "su -c 'cp -f /data/local/tmp/miru_sync/service.sh /data/adb/modules/miru_ui_module/'"
!ADB_CMD! shell "su -c 'cp -f /data/local/tmp/miru_sync/start_miru.bat /data/adb/modules/miru_ui_module/'"
!ADB_CMD! shell "su -c 'cp -f /data/local/tmp/miru_sync/module.prop /data/adb/modules/miru_ui_module/'"

:: Set Permissions
!ADB_CMD! shell "su -c 'chmod -R 755 /data/adb/modules/miru_ui_module/scripts /data/adb/modules/miru_ui_module/system/bin'"
!ADB_CMD! shell "su -c 'chmod 755 /data/adb/modules/miru_ui_module/action.sh /data/adb/modules/miru_ui_module/service.sh'"

:: Create CLI Symlink (Immediate Access)
!ADB_CMD! shell "su -c 'ln -sf /data/adb/modules/miru_ui_module/system/bin/miru /data/local/tmp/miru && chmod 755 /data/local/tmp/miru'"

:: Cleanup
!ADB_CMD! shell "rm -rf /data/local/tmp/miru_sync"
echo [Miru] Sync Complete.

:: --- 3. Start Services ---
echo [Miru] Starting Services...

:: Restart On-Device Server (Port 9090)
!ADB_CMD! shell "su -c 'pkill -f httpd_server; nohup /data/adb/modules/miru_ui_module/system/bin/httpd_server.sh >/dev/null 2>&1 &'" >nul 2>&1

:: Detect Device IP
for /f "tokens=9" %%a in ('!ADB_CMD! shell "ip route | grep wlan0 | grep src"') do set DEVICE_IP=%%a

if defined DEVICE_IP (
    echo [Info] Detected Device IP: !DEVICE_IP!
    set "OPEN_URL=http://!DEVICE_IP!:9090/ide.html?label=OnDevice"
) else (
    echo [Warning] Could not detect Device IP. Falling back to localhost.
    set "OPEN_URL=http://localhost:8000/ide.html"
)

:: Start PC Server
if not defined PYTHON_CMD goto :NoPython

echo [Info] Python detected. Starting PC Bridge Server (Port 8000)...
echo [Info] Web Interface: !OPEN_URL!

:: Auto-Open Browser
start /b cmd /c "timeout /t 2 >nul && start "" !OPEN_URL!"

:: Run Server
"%PYTHON_CMD%" scripts\web_stream.py
exit /b

:NoPython
echo [Warning] Python not found. PC Bridge Server cannot start.
echo [Info] You can access the IDE directly on the device:
echo [Info] URL: !OPEN_URL!

:: Auto-Open Browser (No Python)
start "" "!OPEN_URL!"
pause

