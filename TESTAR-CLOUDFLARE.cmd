@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File "%~dp0desktop\cloud-installer\run-pilot.ps1"
set "PILOT_EXIT=%ERRORLEVEL%"
pause
exit /b %PILOT_EXIT%
