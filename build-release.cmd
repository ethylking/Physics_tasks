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

rem --- Node.js 18+ --------------------------------------------------
rem Vite 6 refuses to start on Node < 18, so when the `node` found via
rem PATH is too old (e.g. an Emscripten SDK copy), prepend a known
rem modern installation instead of failing later inside `vite build`.
set "NODE_EXE="
for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%n"
if not defined NODE_EXE goto :no_node
call :major_of "%NODE_EXE%" NODE_MAJOR
if %NODE_MAJOR% GEQ 18 goto :node_ready

echo   Node.js : v%NODE_MAJOR%.x on PATH is too old for Vite 6 - searching for Node 18+...
call :find_modern_node
if not defined NODE_DIR goto :node_old
set "PATH=%NODE_DIR%;%PATH%"

:node_ready
where npm  >nul 2>nul
if errorlevel 1 goto :no_npm
where cargo >nul 2>nul
if errorlevel 1 goto :no_cargo

for /f "delims=" %%v in ('node --version 2^>nul') do echo   Node.js : %%v
for /f "delims=" %%v in ('cargo --version 2^>nul') do echo   Cargo   : %%v
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

:node_old
echo [ERROR] Node.js 18 or newer is required (Vite 6 cannot run on older versions)
echo         and no modern installation was found in the usual locations.
echo         Install Node.js 18+ from https://nodejs.org/ and run this script again.
goto :abort

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

rem --- Subroutines --------------------------------------------------

:major_of
rem %1 = path to node.exe, %2 = variable that receives the major version
setlocal EnableDelayedExpansion
set "VER="
set "MAJ=0"
if exist "%~1" for /f "tokens=*" %%v in ('"%~1" --version 2^>nul') do set "VER=%%v"
if defined VER (
  set "VER=!VER:v=!"
  for /f "tokens=1 delims=." %%m in ("!VER!") do set "MAJ=%%m"
)
endlocal & set "%~2=%MAJ%"
exit /b 0

:find_modern_node
rem Sets NODE_DIR to the first known installation whose node.exe is 18+.
set "NODE_DIR="
call :try_node_dir "%ProgramFiles%\nodejs"
call :try_node_dir "%ProgramFiles(x86)%\nodejs"
call :try_node_dir "%LOCALAPPDATA%\Programs\nodejs"
call :try_node_dir "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin"
call :try_node_dir "C:\emsdk\node\22.16.0_64bit"
exit /b 0

:try_node_dir
rem %1 = candidate installation directory; kept when it ships Node 18+
if defined NODE_DIR exit /b 0
if not exist "%~1\node.exe" exit /b 0
call :major_of "%~1\node.exe" CAND_MAJOR
if %CAND_MAJOR% GEQ 18 set "NODE_DIR=%~1"
exit /b 0
