@echo off
chcp 65001 >nul
setlocal
set "PS1=%~dp0start-dev.ps1"

where pwsh >nul 2>nul
if not errorlevel 1 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)

if errorlevel 1 (
    echo.
    pause
) else (
    ping -n 3 127.0.0.1 >nul 2>&1
)
endlocal
