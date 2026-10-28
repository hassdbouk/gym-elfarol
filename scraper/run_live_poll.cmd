@echo off
setlocal
cd /d "%~dp0"
set "PY=C:\Users\hass\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" "%~dp0live_poll.py"
endlocal
