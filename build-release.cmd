@echo off
setlocal EnableExtensions

rem ============================================================
rem  MechLab - full release build (Windows)
rem  TypeScript/Vite frontend + Rust/Tauri backend + installers
rem
rem  The script always rebuilds the current working tree:
rem    - synchronizes node_modules with package-lock.json,
rem    - rebuilds dist/ from scratch,
rem    - forces the Tauri application crate to recompile so the
rem      freshly built frontend assets are embedded in the binary.
rem
rem  Usage:
rem    build-release.cmd                      full release build
rem    build-release.cmd --no-bundle          release exe only
rem    build-release.cmd --bundles nsis       specific bundle target
rem    build-release.cmd --help               forward any tauri build args
rem ============================================================

cd /d "%~dp0"
title MechLab release build

echo.
echo ============================================================
echo   MechLab - release build
echo ============================================================
echo.

rem --- Locate Node.js and Cargo even when PATH is minimal --------
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :no_node
where npm  >nul 2>nul
if errorlevel 1 goto :no_npm
where cargo >nul 2>nul
if errorlevel 1 goto :no_cargo

for /f "delims=" %%v in ('node --version') do echo   Node.js : %%v
for /f "delims=" %%v in ('cargo --version') do echo   Cargo   : %%v
echo.

rem --- 1/4 Frontend dependencies --------------------------------
rem Never trust a pre-existing node_modules: if either package.json or
rem package-lock.json changed since the last build, do a clean `npm ci`.
set "DEPS_STAMP=node_modules\.mechlab-release-lock"
if not exist "node_modules" goto :install_deps
if exist "package-lock.json" goto :check_lock
goto :check_package

:check_lock
if not exist "%DEPS_STAMP%" goto :install_deps
fc /b "package-lock.json" "%DEPS_STAMP%" >nul 2>nul
if errorlevel 1 goto :install_deps
if not exist "node_modules\.mechlab-release-package" goto :install_deps
fc /b "package.json" "node_modules\.mechlab-release-package" >nul 2>nul
if errorlevel 1 goto :install_deps
echo [1/4] Frontend dependencies match package.json and package-lock.json - skipping install.
goto :deps_ready

:check_package
if not exist "node_modules\.mechlab-release-package" goto :install_deps
fc /b "package.json" "node_modules\.mechlab-release-package" >nul 2>nul
if errorlevel 1 goto :install_deps
echo [1/4] Frontend dependencies match package.json - skipping install.
goto :deps_ready

:install_deps
echo [1/4] Synchronizing frontend dependencies...
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :fail_deps
if exist "package-lock.json" copy /y "package-lock.json" "%DEPS_STAMP%" >nul
if exist "package.json" copy /y "package.json" "node_modules\.mechlab-release-package" >nul

:deps_ready
echo.

rem --- 2/4 Fresh build output ------------------------------------
rem Remove dist/ and old installers explicitly so no stale artifact can
rem survive the rebuild or be reported as if it belonged to this build.
set "OUT=src-tauri\target\release"
echo [2/4] Clearing previous frontend output and installer bundles...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
  echo [ERROR] Could not remove dist\ - close any program using it and retry.
  goto :fail_build
)
if exist "%OUT%\bundle" rmdir /s /q "%OUT%\bundle"
if exist "%OUT%\bundle" (
  echo [ERROR] Could not remove %OUT%\bundle - close any program using it and retry.
  goto :fail_build
)
echo.

rem --- 3/4 Release build + bundle -------------------------------
rem Cargo tracks source/config changes, but force the application crate
rem itself to rebuild so the current dist/ is always embedded.
echo [3/4] Forcing the application crate to rebuild...
cargo clean --manifest-path "src-tauri\Cargo.toml" -p physics-tasks
if errorlevel 1 goto :fail_build
echo.

echo [3/4] Building TypeScript/Vite frontend and Rust backend in release mode...
echo       (the first build can take several minutes)
echo.
call npm run tauri build -- %*
if errorlevel 1 goto :fail_build
echo.

rem --- 4/4 Report artifacts -------------------------------------
echo [4/4] Release build complete.
echo.
echo   Output directory : %CD%\%OUT%
if exist "%OUT%\bundle\*" (
  echo   Bundles          : %CD%\%OUT%\bundle
  for /d %%d in ("%OUT%\bundle\*") do echo                      - %%~nxd
)
if exist "%OUT%\*.exe" (
  echo   Executables:
  for %%f in ("%OUT%\*.exe") do echo                      - %%~nxf
)
echo.
goto :success

:no_node
echo [ERROR] Node.js was not found.
echo         Install Node.js 18+ from https://nodejs.org/ and run this script again.
goto :abort

:no_npm
echo [ERROR] npm was not found next to Node.js.
echo         Reinstall Node.js with npm included and run this script again.
goto :abort

:no_cargo
echo [ERROR] Cargo was not found.
echo         Install the Rust toolchain from https://rustup.rs/ and run this script again.
goto :abort

:fail_deps
echo.
echo [ERROR] Could not install frontend dependencies.
goto :abort

:fail_build
echo.
echo [ERROR] Release build failed - see the messages above.
goto :abort

:abort
echo.
echo Build aborted.
exit /b 1

:success
echo Done.
exit /b 0
