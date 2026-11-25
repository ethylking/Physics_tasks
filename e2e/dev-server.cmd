@echo off

rem e2e/dev-server.cmd - vite dev server for the Playwright webServer.

rem Runs from the repo root with the Tauri backend replaced by the in-memory

rem browser mock (MECHLAB_E2E=1 alias in vite.config.ts). Node 24 from the

rem harness runtime is used explicitly (system Node v15 cannot run Vite 6).

cd /d "%~dp0.."

set "MECHLAB_E2E=1"

rem --host 127.0.0.1: Node 24 resolves localhost to IPv6 ::1 only, but the

rem Playwright webServer health-check probes http://127.0.0.1:5199.

"C:\Users\rogoveshko\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5199 --strictPort