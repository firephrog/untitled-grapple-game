# start.ps1 — launch the C++ physics server and the Node.js game server together.
# Run from the repo root:  .\start.ps1
# Optional flag to also start the Vite dev client:  .\start.ps1 -Client

param([switch]$Client)

$root = $PSScriptRoot

function Wait-ForTcpPort {
    param(
        [string]$Host,
        [int]$Port,
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $client.BeginConnect($Host, $Port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
                $client.EndConnect($iar) | Out-Null
                return $true
            }
        }
        catch {
            # Port not ready yet.
        }
        finally {
            $client.Close()
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

# ── Build C++ server so runtime uses latest code ─────────────────────────────
# Use the VS/MSBuild tree — it handles the MSVC + Rust/Cargo environment itself
# and correctly detects source changes.  The ninja tree requires a manual VS
# dev-prompt and cannot run Cargo inside a bare cmd /c invocation.
$buildOk = $false
Push-Location (Join-Path $root 'cpp-server')
try {
    Write-Host "[start] Building C++ server (build\Release)..." -ForegroundColor DarkYellow
    & cmake --build build --config Release
    if ($LASTEXITCODE -eq 0) {
        $buildOk = $true
        Write-Host "[start] C++ build OK." -ForegroundColor DarkGreen
    } else {
        Write-Host "[start] C++ build failed (exit $LASTEXITCODE)." -ForegroundColor Red
    }
}
finally {
    Pop-Location
}

if (-not $buildOk) {
    Write-Host "[start] WARNING: C++ build failed. Continuing with existing binary if present." -ForegroundColor Yellow
}

# ── Build client bundle so /public serves latest JS changes ──────────────────
$clientBuildOk = $false
Push-Location $root
try {
    Write-Host "[start] Building client bundle (Vite -> public)..." -ForegroundColor DarkYellow
    & npm run build
    if ($LASTEXITCODE -eq 0) {
        $clientBuildOk = $true
        Write-Host "[start] Client build OK." -ForegroundColor DarkGreen
    } else {
        Write-Host "[start] Client build failed (exit $LASTEXITCODE)." -ForegroundColor Red
    }
}
finally {
    Pop-Location
}

if (-not $clientBuildOk) {
    Write-Host "[start] WARNING: Client build failed. Continuing with existing public bundle." -ForegroundColor Yellow
}

# ── Locate the C++ binary ─────────────────────────────────────────────────────
$cppBin = Join-Path $root 'cpp-server\build\Release\ugg-server.exe'
if (-not (Test-Path $cppBin)) {
    Write-Host "[start] ERROR: ugg-server.exe not found. Build it first:" -ForegroundColor Red
    Write-Host "  cd cpp-server && cmake --build build --config Release" -ForegroundColor Yellow
    exit 1
}

# ── Kill any leftover processes ────────────────────────────────────────────────
Write-Host "[start] Stopping any existing processes..." -ForegroundColor DarkGray
Get-Process -Name ugg-server -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name node       -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -eq '' -or $_.MainWindowTitle -match 'node'
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

# ── Start C++ servers in separate windows (PVP + FFA) ───────────────────────
Write-Host "[start] Starting C++ PVP physics server on :50051..." -ForegroundColor Cyan
$cppPvp = Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command `"`$env:GRPC_PORT='50051'; `$env:WS_PORT='51051'; & '$cppBin'`"" `
    -WorkingDirectory (Split-Path $cppBin) `
    -PassThru
Write-Host "  PID $($cppPvp.Id)  →  $cppBin (gRPC 50051, WS 51051)" -ForegroundColor DarkCyan

Write-Host "[start] Starting C++ FFA physics server on :50052..." -ForegroundColor Cyan
$cppFfa = Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command `"`$env:GRPC_PORT='50052'; `$env:WS_PORT='51052'; & '$cppBin'`"" `
    -WorkingDirectory (Split-Path $cppBin) `
    -PassThru
Write-Host "  PID $($cppFfa.Id)  →  $cppBin (gRPC 50052, WS 51052)" -ForegroundColor DarkCyan

# Wait for both gRPC ports to bind before Node tries to connect.
$pvpReady = Wait-ForTcpPort -Host '127.0.0.1' -Port 50051
$ffaReady = Wait-ForTcpPort -Host '127.0.0.1' -Port 50052
if (-not $pvpReady) {
    Write-Host "[start] WARNING: PVP gRPC port 50051 did not become ready in time." -ForegroundColor Yellow
}
if (-not $ffaReady) {
    Write-Host "[start] WARNING: FFA gRPC port 50052 did not become ready in time." -ForegroundColor Yellow
}

# ── Start Node.js server in its own window ────────────────────────────────────
Write-Host "[start] Starting Node.js game server..." -ForegroundColor Green
$node = Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command `"cd '$root'; `$env:CPP_SERVER_ADDR='127.0.0.1:50051'; `$env:FFA_CPP_SERVER_ADDR='127.0.0.1:50052'; `$env:CPP_PVP_WS_PORT='51051'; `$env:CPP_FFA_WS_PORT='51052'; npm start`"" `
    -WorkingDirectory $root `
    -PassThru
Write-Host "  PID $($node.Id)  →  npm start" -ForegroundColor DarkGreen

# ── Optionally start Vite dev client ─────────────────────────────────────────
if ($Client) {
    Write-Host "[start] Starting Vite dev client..." -ForegroundColor Magenta
    $vite = Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command `"cd '$root\client'; npm run dev`"" `
        -WorkingDirectory "$root\client" `
        -PassThru
    Write-Host "  PID $($vite.Id)  →  npm run dev" -ForegroundColor DarkMagenta
}

Write-Host ""
Write-Host "All processes launched. Close the windows to stop them." -ForegroundColor White
Write-Host "To also start the Vite dev client, run:  .\start.ps1 -Client" -ForegroundColor DarkGray
