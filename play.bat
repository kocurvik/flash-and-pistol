@echo off
title Flash and Pistol server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again.
  echo.
  pause
  exit /b 1
)
node server.js --open
pause
