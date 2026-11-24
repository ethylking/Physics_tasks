$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;C:\Users\USER\AppData\Roaming\npm;C:\Users\USER\.cargo\bin;" + $env:Path
# Expose the WebView2 debug port so scripts/cdp-smoke.mjs can inspect the app.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"

$log = "$env:TEMP\tauri-m2c.log"
Remove-Item $log -ErrorAction SilentlyContinue
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run tauri dev > `"$log`" 2>&1" -WorkingDirectory "D:\CPP_Projects\Physics_tasks" -PassThru -WindowStyle Hidden

$deadline = (Get-Date).AddMinutes(10)
$launched = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    if (Get-Process -Name "physics-tasks" -ErrorAction SilentlyContinue) { $launched = $true; break }
    if (Test-Path $log) {
        $content = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($content -match "error\[E\d|error: could not|error: linking") { break }
    }
}
Write-Output "LAUNCHED=$launched"

if ($launched) {
    Start-Sleep -Seconds 25
    # Click candidates across the canvas; expect at least one to select a body,
    # then run the simulation and capture the energy HUD + a post-run screenshot.
    node "D:\CPP_Projects\Physics_tasks\scripts\cdp-smoke.mjs" "$env:TEMP\mechlab-cdp.png" "510,380;530,390;550,355;480,370;500,410;540,420" "2d" "play"
    Write-Output "CDP exit: $LASTEXITCODE"
}

Get-Content $log -Tail 8 -ErrorAction SilentlyContinue
Get-Process -Name "physics-tasks" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
taskkill /PID $p.Id /T /F 2>$null | Out-Null
Write-Output "SMOKE DONE"
