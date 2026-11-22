@echo off
:: Run as Administrator (UAC)
>nul 2>&1 net session
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0app"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Portable Zapret + TG Proxy (Admin)...
call npm start

