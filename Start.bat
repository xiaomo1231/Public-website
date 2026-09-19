@echo off
rem ============================================================
rem  AI Learning Platform - entry point
rem
rem  Delegates to launcher\windows.ps1, which:
rem    1. checks Node.js / npm and the required version
rem    2. offers to install Node.js (only after you confirm)
rem    3. re-checks after installing
rem    4. installs dependencies if needed
rem    5. starts the dev server
rem
rem  This file is ASCII-only on purpose: cmd.exe reads batch files
rem  in the OEM code page, so non-ASCII text here would be mangled.
rem ============================================================

setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Windows PowerShell was not found on PATH.
  echo.
  echo  This launcher needs PowerShell, which ships with Windows 7
  echo  and later. If it is missing, run the commands manually:
  echo.
  echo      npm install
  echo      npm run dev
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\windows.ps1"
set "EXITCODE=%errorlevel%"

endlocal & exit /b %EXITCODE%
