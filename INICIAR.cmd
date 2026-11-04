@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 24 LTS a partir de https://nodejs.org e volte a abrir este ficheiro.
  pause
  exit /b 1
)
node scripts/launch.mjs %*
if errorlevel 1 pause
