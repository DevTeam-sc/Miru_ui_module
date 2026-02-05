@echo off
setlocal
title Miru Wireless Connector

echo [Miru] Wireless Debugging Setup
echo --------------------------------

:: Default IP
set "TARGET_IP=192.168.1.80"

:: Check if IP provided as argument
if not "%~1"=="" set "TARGET_IP=%~1"

echo [1] Checking for USB device...
adb devices -l | findstr "usb" >nul
if %errorlevel% equ 0 (
    echo [*] USB Device found. Enabling TCP/IP mode...
    adb tcpip 5555
    timeout /t 2 >nul
) else (
    echo [!] No USB device found. Trying to connect directly...
)

echo [2] Connecting to %TARGET_IP%...
adb connect %TARGET_IP%:5555

echo.
echo [Status]
adb devices

echo.
echo [Done] You can now unplug the USB cable if connected.
echo.
pause
