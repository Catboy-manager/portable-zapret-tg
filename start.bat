@echo off
cd /d "%~dp0app"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Portable Zapret + TG Proxy...
call npm start

