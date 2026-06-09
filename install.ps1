# PICPIO Installer for Windows
# Run: iex (irm https://raw.githubusercontent.com/123him/picpio/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/123him/picpio/main'
$REPO_REL    = 'https://github.com/123him/picpio/releases/latest/download'

Write-Host ""
Write-Host "  PICPIO Installer" -ForegroundColor Cyan
Write-Host "  PIC Microcontroller IDE for VS Code" -ForegroundColor Cyan
Write-Host ""

# ── 1. Create install directory ───────────────────────────────────────────────
New-Item -ItemType Directory -Force $INSTALL_DIR | Out-Null
Write-Host "[1/5] Install directory: $INSTALL_DIR" -ForegroundColor Green

# ── 2. Download CLI tool ──────────────────────────────────────────────────────
Write-Host "[2/5] Downloading picpio tool..." -ForegroundColor Green
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.js"  -OutFile "$INSTALL_DIR\picpio.js"
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.cmd" -OutFile "$INSTALL_DIR\picpio.cmd"

# ── 3. Download arduino_compat HAL ───────────────────────────────────────────
Write-Host "[3/5] Downloading Arduino HAL..." -ForegroundColor Green
$acDir = "$INSTALL_DIR\arduino_compat"
New-Item -ItemType Directory -Force $acDir | Out-Null

$acFiles = @(
    'Arduino.h', 'wiring.c', 'main_entry.c',
    'Wire.h', 'SPI.h', 'pins_arduino.h'
)
foreach ($f in $acFiles) {
    try {
        Invoke-WebRequest "$REPO_RAW/picpio-vscode/arduino_compat/$f" -OutFile "$acDir\$f"
    } catch {
        Write-Host "  (skipped $f — not in repo)" -ForegroundColor DarkGray
    }
}

# ── 4. Add C:\picpio to system PATH (requires admin) ─────────────────────────
Write-Host "[4/5] Adding to PATH..." -ForegroundColor Green
$machine = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
if ($machine -notlike "*$INSTALL_DIR*") {
    try {
        [System.Environment]::SetEnvironmentVariable('PATH', "$machine;$INSTALL_DIR", 'Machine')
        Write-Host "  Added $INSTALL_DIR to system PATH" -ForegroundColor Green
    } catch {
        # Fallback: add to user PATH (no admin needed)
        $user = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        if ($user -notlike "*$INSTALL_DIR*") {
            [System.Environment]::SetEnvironmentVariable('PATH', "$user;$INSTALL_DIR", 'User')
        }
        Write-Host "  Added $INSTALL_DIR to user PATH" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Already in PATH" -ForegroundColor DarkGray
}

# ── 5. Install VS Code extension ──────────────────────────────────────────────
Write-Host "[5/5] Installing VS Code extension..." -ForegroundColor Green
$vsix = "$env:TEMP\picpio.vsix"
try {
    Invoke-WebRequest "$REPO_REL/picpio.vsix" -OutFile $vsix
    & code --install-extension $vsix
    Remove-Item $vsix -Force -ErrorAction SilentlyContinue
    Write-Host "  Extension installed" -ForegroundColor Green
} catch {
    Write-Host "  Could not install extension automatically." -ForegroundColor Yellow
    Write-Host "  Download picpio.vsix from: https://github.com/123him/picpio/releases" -ForegroundColor Yellow
    Write-Host "  Then: Extensions panel → ... → Install from VSIX" -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  PICPIO installed successfully!" -ForegroundColor Cyan
Write-Host "  Restart VS Code or open a new terminal, then:" -ForegroundColor White
Write-Host "  picpio --version" -ForegroundColor Yellow
Write-Host ""
