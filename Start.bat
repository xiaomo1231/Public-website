@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo    AI Learning Platform  -  Quick Start
echo  ============================================
echo.

rem ---- Check Node.js ----------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on PATH.
  echo.
  echo  Install Node.js 20 or newer from https://nodejs.org/
  echo  then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo  Node.js  %NODE_VERSION%

rem ---- Warn if the version is too old -----------------------------------
for /f "tokens=1 delims=." %%a in ("!NODE_VERSION:v=!") do set "NODE_MAJOR=%%a"
if !NODE_MAJOR! LSS 20 (
  echo.
  echo  [WARNING] Node.js 20 or newer is recommended ^(found !NODE_VERSION!^).
  echo            Continuing anyway...
)

rem ---- Install dependencies on first run --------------------------------
if not exist "node_modules" (
  echo.
  echo  First run detected - installing dependencies.
  echo  This can take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] "npm install" failed. Scroll up for details.
    echo.
    pause
    exit /b 1
  )
)

rem ---- Start the dev server --------------------------------------------
echo.
echo  Starting the development server...
echo  Your browser should open automatically.
echo  Press Ctrl+C in this window to stop.
echo.

call npm run dev -- --open

rem ---- Keep the window open if the server exits with an error ----------
if errorlevel 1 (
  echo.
  echo  [ERROR] The dev server exited unexpectedly. Scroll up for details.
  echo.
  pause
  exit /b 1
)

echo.
echo  Server stopped.
pause
endlocal
