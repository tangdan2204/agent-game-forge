@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "ROOT=%~dp0"
set "OPEN_BROWSER=1"
if /I "%~1"=="--no-browser" set "OPEN_BROWSER=0"

cd /d "%ROOT%" || (
  echo [ERROR] Cannot enter project directory:
  echo         "%ROOT%"
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  goto :fail
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell is not available in PATH.
  goto :fail
)

call :healthcheck
if "!HEALTH_OK!"=="1" (
  echo [INFO] AGF is already running.
  if "%OPEN_BROWSER%"=="1" start "" "http://localhost:7620"
  goto :ok
)

if not exist "node_modules\" (
  echo [INFO] node_modules not found. Running npm install...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    goto :fail
  )
)

if not exist ".launcher\" mkdir ".launcher" >nul 2>nul
set "AGF_ROOT=%CD%"
set "OUT_LOG=%AGF_ROOT%\.launcher\dev.out.log"
set "ERR_LOG=%AGF_ROOT%\.launcher\dev.err.log"

echo [INFO] Starting AGF dev services...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$wd=$env:AGF_ROOT; $out=$env:OUT_LOG; $err=$env:ERR_LOG; if(Test-Path $out){ Remove-Item -Force $out }; if(Test-Path $err){ Remove-Item -Force $err }; Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $wd -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null"
if errorlevel 1 (
  echo [ERROR] Failed to start npm run dev.
  goto :fail
)

echo [INFO] Waiting for daemon health check...
set "HEALTH_OK=0"
for /L %%I in (1,1,60) do (
  call :healthcheck
  if "!HEALTH_OK!"=="1" goto :started
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1" >nul 2>nul
)

echo [WARN] Health check timed out.
echo [WARN] Check startup logs:
echo        "%OUT_LOG%"
echo        "%ERR_LOG%"
if "%OPEN_BROWSER%"=="1" start "" "http://localhost:7620"
goto :ok

:started
echo [OK] AGF started successfully.
if "%OPEN_BROWSER%"=="1" start "" "http://localhost:7620"
goto :ok

:healthcheck
set "HEALTH_OK=0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:7621/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set "HEALTH_OK=1"
exit /b 0

:ok
exit /b 0

:fail
echo.
echo Press any key to exit...
pause >nul
exit /b 1
