@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================
echo    AI Learning Platform  -  Quick Start
echo  ============================================
echo.
echo  Folder: %CD%
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
echo  Node.js  !NODE_VERSION!

rem ---- Warn if the version is too old -----------------------------------
set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%a in ("!NODE_VERSION:v=!") do set "NODE_MAJOR=%%a"
if !NODE_MAJOR! LSS 20 (
  echo.
  echo  [WARNING] Node.js 20 or newer is recommended ^(found !NODE_VERSION!^).
  echo            Continuing anyway...
)

rem ---- Check npm --------------------------------------------------------
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] npm was not found on PATH.
  echo.
  echo  Reinstall Node.js ^(npm ships with it^) from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem ---- Make sure port 5173 is free --------------------------------------
rem Everything this app stores lives in the browser's IndexedDB, which is
rem scoped to the page origin. Vite is pinned to port 5173 (strictPort) so
rem the origin never changes; a dev server left over from a previous run
rem would therefore block startup. Offer to clear it instead of failing.
call :EnsurePortFree 5173
if errorlevel 1 (
  echo.
  echo  [ERROR] Port 5173 is still in use, so the app cannot start.
  echo          Free the port and run this file again.
  echo.
  pause
  exit /b 1
)

rem ---- Ensure dependencies are present, complete and current -----------
rem This is what makes the folder portable between machines: a node_modules
rem copied from another computer (wrong OS, wrong Node version, or stale)
rem would otherwise be reused and crash at startup.
set "DEPS_REASON="
set "DEPS_CLEAN="
call :CheckDeps

if defined DEPS_REASON (
  echo.
  echo  Dependencies: !DEPS_REASON!.
  if defined DEPS_CLEAN (
    echo  Removing the existing node_modules folder so it can be rebuilt
    echo  for this machine ^(it is a build artefact and is regenerated^).
    rmdir /s /q "node_modules" 2>nul
  )
  echo.
  echo  Running "npm install" - this can take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] "npm install" failed. Scroll up for details.
    echo.
    echo  Common fixes:
    echo    - check your internet connection
    echo    - delete the "node_modules" folder and run this file again
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
echo  Always use the same address:  http://localhost:5173
echo  Do NOT use the "Network" address: it is a different origin and
echo  would show an empty workspace.
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
exit /b 0

rem ======================================================================
rem  :CheckDeps
rem  Sets DEPS_REASON (and DEPS_CLEAN for a rebuild) when dependencies are
rem  missing, incomplete, built for another OS, or older than the lockfile.
rem ======================================================================
:CheckDeps
if not exist "node_modules" (
  set "DEPS_REASON=not installed yet"
  exit /b 0
)

rem npm only creates .cmd shims on Windows. Their absence means this folder
rem was installed on macOS/Linux (or the install is broken).
if not exist "node_modules\.bin\vite.cmd" (
  set "DEPS_REASON=built for a different operating system"
  set "DEPS_CLEAN=1"
  exit /b 0
)

rem npm writes this marker on every successful install.
if not exist "node_modules\.package-lock.json" (
  set "DEPS_REASON=incomplete"
  set "DEPS_CLEAN=1"
  exit /b 0
)

if not exist "package-lock.json" exit /b 0

rem A lockfile newer than the install marker means package.json changed.
rem If PowerShell is unavailable the check is skipped and we carry on.
for /f "delims=" %%S in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Item -LiteralPath 'package-lock.json').LastWriteTime -gt (Get-Item -LiteralPath 'node_modules\.package-lock.json').LastWriteTime) { 'out of date' }" 2^>nul') do set "DEPS_REASON=%%S"
exit /b 0

rem ======================================================================
rem  :EnsurePortFree <port>
rem  Exits 0 when the port is free (or was freed by the user's consent),
rem  and 1 when it is still occupied.
rem ======================================================================
:EnsurePortFree
set "PORT=%~1"
call :PortHolder %PORT%
if not defined HOLDER exit /b 0

echo.
echo  [WARN] Port %PORT% is already in use ^(process !HOLDER!^).
echo         This is usually a dev server left running from an earlier
echo         session. The app has to keep port %PORT%, otherwise the
echo         browser treats it as a different site and your saved
echo         projects and AI settings appear to be gone.
echo.
set "ANSWER="
set /p "ANSWER=  Stop that process and continue? [Y/N] "
if /i not "!ANSWER!"=="Y" (
  echo.
  echo  Cancelled - process !HOLDER! was left running.
  exit /b 1
)

taskkill /PID !HOLDER! /T /F >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Could not stop process !HOLDER!.
  echo          Try running this file as Administrator.
  exit /b 1
)

rem Windows can take several seconds to release a socket, and slower machines
rem take longer, so retry instead of checking once.
rem (`timeout` refuses to run when stdin is redirected, so use ping.)
set /a WAITED=0
:WaitForPort
call :PortHolder %PORT%
if not defined HOLDER (
  echo  Port %PORT% is free again.
  exit /b 0
)
set /a WAITED+=1
if !WAITED! GEQ 5 (
  echo.
  echo  [ERROR] Port %PORT% is still held by process !HOLDER!.
  echo          Close that process and run this file again.
  exit /b 1
)
ping -n 3 127.0.0.1 >nul 2>nul
goto WaitForPort

rem ======================================================================
rem  :PortHolder <port>
rem  Sets HOLDER to the PID listening on the port, or clears it if free.
rem  If PowerShell is unavailable the check is skipped and Vite will report
rem  a port conflict itself.
rem ======================================================================
:PortHolder
set "HOLDER="
for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c[0].OwningProcess }" 2^>nul') do set "HOLDER=%%P"
exit /b 0
