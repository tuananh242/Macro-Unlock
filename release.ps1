<#
  release.ps1 - Build backend + Electron roi deploy de len thu muc cai dat
                ma shortcut Desktop dang tro toi.

  Shortcut: "Cryss.exe - Shortcut.lnk" -> D:\Downloads\Macro Skirk\win-unpacked\Cryss.exe

  Script GIU LAI state cua user (config combo, gamepath, setting unlocker),
  vi electron-builder se ghi de nguyen thu muc resources\unlocker.

  Dung:  powershell -ExecutionPolicy Bypass -File release.ps1
         -SkipBackend   bo qua buoc PyInstaller (chi doi code UI)
#>
param(
    [string]$Install = "D:\Downloads\Macro Skirk\win-unpacked",
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    !   $msg" -ForegroundColor Yellow }

# File state cua user - build KHONG duoc lam mat
$Preserve = @(
    "resources\config.json",
    "resources\mavuika.json",
    "resources\unlocker\gamepath.json",
    "resources\unlocker\config.ini",
    "resources\unlocker\Plugins\UnlockerIsland\config.ini"
)

# ── 1. Backend (PyInstaller) ──────────────────────────────────────────────
if ($SkipBackend) {
    Step 1 "Bo qua build backend (-SkipBackend)"
} else {
    Step 1 "Build backend Python -> Cryss.exe"
    $venv = Join-Path $Repo "build\venv"
    $py   = Join-Path $venv "Scripts\python.exe"
    if (-not (Test-Path $py)) {
        Warn "Chua co venv, dang tao tai build\venv"
        python -m venv $venv
        & $py -m pip install --quiet --upgrade pip
        & $py -m pip install --quiet pyinstaller pynput
    }
    $bdir = Join-Path $Repo "build"
    Push-Location $bdir
    try {
        & (Join-Path $venv "Scripts\pyinstaller.exe") --clean --noupx --onefile --windowed `
            --name "Cryss" --workpath "temp" --specpath "temp" --distpath "dist" `
            --collect-all pynput `
            --hidden-import pynput.keyboard._win32 --hidden-import pynput.mouse._win32 `
            (Join-Path $Repo "src\macro\main.py") | Out-Null
    } finally { Pop-Location }
    $exe = Join-Path $Repo "build\dist\Cryss.exe"
    if (-not (Test-Path $exe)) { throw "Build backend that bai: khong thay $exe" }
    Ok "$exe ($([math]::Round((Get-Item $exe).Length/1MB,1)) MB)"
}

# ── 2. Electron ───────────────────────────────────────────────────────────
Step 2 "Build Electron -> build\app\win-unpacked"
Push-Location (Join-Path $Repo "src\UI")
try { pnpm package:win | Out-Null } finally { Pop-Location }
$Out = Join-Path $Repo "build\app\win-unpacked"
if (-not (Test-Path (Join-Path $Out "Cryss.exe"))) { throw "Build Electron that bai: khong thay $Out\Cryss.exe" }
Ok $Out

# ── 3. Backup state user ──────────────────────────────────────────────────
Step 3 "Backup state user tu thu muc cai dat"
$Tmp = Join-Path $env:TEMP "cryss-release-$Stamp"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
$saved = @()
foreach ($rel in $Preserve) {
    $src = Join-Path $Install $rel
    if (Test-Path $src) {
        $dst = Join-Path $Tmp $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item $src $dst -Force
        $saved += $rel
        Ok $rel
    } else { Warn "khong co: $rel" }
}

# ── 4. Backup ban dang chay + deploy ──────────────────────────────────────
Step 4 "Backup ban cu roi deploy"
foreach ($f in @("Cryss.exe", "resources\app.asar", "resources\Cryss.exe")) {
    $p = Join-Path $Install $f
    if (Test-Path $p) { Copy-Item $p "$p.bak" -Force }
}
Ok "da tao .bak cho Cryss.exe / app.asar / resources\Cryss.exe"

Copy-Item -Path (Join-Path $Out "*") -Destination $Install -Recurse -Force
Ok "copy de xong"

# ── 5. Khoi phuc state user ───────────────────────────────────────────────
Step 5 "Khoi phuc state user"
foreach ($rel in $saved) {
    $src = Join-Path $Tmp $rel
    $dst = Join-Path $Install $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Force
    Ok $rel
}
Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n=== RELEASE XONG ===" -ForegroundColor Green
Write-Host "Shortcut Desktop da tro san vao: $Install\Cryss.exe"
