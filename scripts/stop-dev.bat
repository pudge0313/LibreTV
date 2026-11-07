@echo off
chcp 65001 >nul
setlocal
set "PS1=%~dp0start-dev.ps1"

where pwsh >nul 2>nul
if not errorlevel 1 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Stop
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Stop
)

echo.
pause
endlocal
