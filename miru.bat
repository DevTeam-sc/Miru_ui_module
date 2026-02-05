@echo off
rem Miru CLI Wrapper for Windows
rem Enables "miru <command>" directly from PC terminal
rem Wraps: adb shell su -c '/data/local/tmp/miru <command>'

set "CMD=%*"
if "%CMD%"=="" set "CMD=status"

adb shell "su -c '/data/local/tmp/miru %CMD%'"
