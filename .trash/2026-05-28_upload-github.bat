@echo off
title Upload Project To GitHub
cd /d "%~dp0"
echo Running upload script...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload-github.ps1"
echo.
echo Press any key to close this window...
pause >nul
