# PICPIO Full Installer for Windows
# Installs: XC8 compiler + MPLAB X IPE + picpio tool + VS Code extension
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/123him/picpio/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/123him/picpio/main'
$REPO_REL    = 'https://github.com/123him/picpio/releases/latest/download'

# ── Microchip download URLs ───────────────────────────────────────────────────
# Update these when Microchip releases new versions
$XC8_URL     = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc8-v3.10-full-install-windows-x64-installer.exe'
$MPLABX_URL  = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/MPLABX-v6.00-windows-installer.exe'

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

Write-Host ""
Write-Host "  ██████╗ ██╗ ██████╗██████╗ ██╗ ██████╗ " -ForegroundColor Cyan
Write-Host "  ██╔══██╗██║██╔════╝██╔══██╗██║██╔═══██╗" -ForegroundColor Cyan
Write-Host "  ██████╔╝██║██║     ██████╔╝██║██║   ██║" -ForegroundColor Cyan
Write-Host "  ██╔═══╝ ██║██║     ██╔═══╝ ██║██║   ██║" -ForegroundColor Cyan
Write-Host "  ██║     ██║╚██████╗██║     ██║╚██████╔╝" -ForegroundColor Cyan
Write-Host "  ╚═╝     ╚═╝ ╚═════╝╚═╝     ╚═╝ ╚═════╝ " -ForegroundColor Cyan
Write-Host "  PIC Microcontroller IDE for VS Code" -ForegroundColor DarkCyan
Write-Host ""

# ── Helper: download with progress bar ───────────────────────────────────────
function Download($url, $dest) {
    $wc = New-Object System.Net.WebClient
    $wc.DownloadProgressChanged += {
        $pct = $_.ProgressPercentage
        Write-Progress -Activity "Downloading" -Status "$pct%" -PercentComplete $pct
    }
    $wc.DownloadFileTaskAsync($url, $dest).Wait()
    Write-Progress -Activity "Downloading" -Completed
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — XC8 Compiler
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step 1 "XC8 Compiler (Microchip)"

$xc8Found = Test-Path "C:\Program Files\Microchip\xc8"
if ($xc8Found) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc8" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC8 $ver — skipping"
} else {
    Write-Info "Downloading XC8 compiler (~150 MB)..."
    $xc8Installer = "$env:TEMP\xc8-installer.exe"
    try {
        Download $XC8_URL $xc8Installer
        Write-Info "Running XC8 installer (follow the prompts, accept the free license)..."
        Start-Process $xc8Installer -Wait
        Remove-Item $xc8Installer -Force -ErrorAction SilentlyContinue
        if (Test-Path "C:\Program Files\Microchip\xc8") {
            Write-Info "XC8 installed successfully."
        } else {
            Write-Warn "XC8 installer may have been cancelled."
            Write-Warn "Download manually: https://www.microchip.com/xc8"
        }
    } catch {
        Write-Warn "Could not auto-download XC8."
        Write-Warn "Install manually from: https://www.microchip.com/xc8"
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — MPLAB X IPE (programmer/uploader)
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step 2 "MPLAB X IPE (programmer software)"

$mplabFound = Test-Path "C:\Program Files\Microchip\MPLABX"
if ($mplabFound) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\MPLABX" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: MPLAB X $ver — skipping"
} else {
    Write-Info "Downloading MPLAB X (~700 MB)..."
    $mplabInstaller = "$env:TEMP\mplabx-installer.exe"
    try {
        Download $MPLABX_URL $mplabInstaller
        Write-Info "Running MPLAB X installer (follow the prompts)..."
        Start-Process $mplabInstaller -Wait
        Remove-Item $mplabInstaller -Force -ErrorAction SilentlyContinue
        if (Test-Path "C:\Program Files\Microchip\MPLABX") {
            Write-Info "MPLAB X installed successfully."
        } else {
            Write-Warn "MPLAB X installer may have been cancelled."
            Write-Warn "Download manually: https://www.microchip.com/mplabx"
        }
    } catch {
        Write-Warn "Could not auto-download MPLAB X."
        Write-Warn "Install manually from: https://www.microchip.com/mplabx"
    }
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — PICPIO tool (picpio.js + arduino_compat)
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step 3 "PICPIO tool"

New-Item -ItemType Directory -Force $INSTALL_DIR | Out-Null

Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.js"  -OutFile "$INSTALL_DIR\picpio.js"
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.cmd" -OutFile "$INSTALL_DIR\picpio.cmd"
Write-Info "picpio.js installed to $INSTALL_DIR"

$acDir = "$INSTALL_DIR\arduino_compat"
New-Item -ItemType Directory -Force $acDir | Out-Null
foreach ($f in @('Arduino.h','wiring.c','main_entry.c')) {
    try   { Invoke-WebRequest "$REPO_RAW/picpio-vscode/arduino_compat/$f" -OutFile "$acDir\$f" }
    catch { Write-Skip "  (skipped $f)" }
}
Write-Info "Arduino HAL installed to $acDir"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Add C:\picpio to PATH
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step 4 "System PATH"

$machine = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
if ($machine -notlike "*$INSTALL_DIR*") {
    try {
        [System.Environment]::SetEnvironmentVariable('PATH', "$machine;$INSTALL_DIR", 'Machine')
        Write-Info "Added $INSTALL_DIR to system PATH"
    } catch {
        $user = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        if ($user -notlike "*$INSTALL_DIR*") {
            [System.Environment]::SetEnvironmentVariable('PATH', "$user;$INSTALL_DIR", 'User')
        }
        Write-Warn "Added to user PATH (run as admin for system PATH)"
    }
} else {
    Write-Skip "Already in PATH"
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — VS Code extension
# ═══════════════════════════════════════════════════════════════════════════════
Write-Step 5 "VS Code extension"

$codeCmd = (Get-Command code -ErrorAction SilentlyContinue)?.Source
if (-not $codeCmd) {
    # VS Code not in PATH yet — try common locations
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        "C:\Program Files\Microsoft VS Code\bin\code.cmd"
    )
    $codeCmd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($codeCmd) {
    $vsix = "$env:TEMP\picpio.vsix"
    try {
        Invoke-WebRequest "$REPO_REL/picpio.vsix" -OutFile $vsix
        & $codeCmd --install-extension $vsix | Out-Null
        Remove-Item $vsix -Force -ErrorAction SilentlyContinue
        Write-Info "Extension installed in VS Code"
    } catch {
        Write-Warn "Could not auto-install extension."
        Write-Warn "Download picpio.vsix from: https://github.com/123him/picpio/releases"
        Write-Warn "Then in VS Code: Extensions → ··· → Install from VSIX"
    }
} else {
    Write-Warn "VS Code not found. Install from https://code.visualstudio.com"
    Write-Warn "Then install the extension from: https://github.com/123him/picpio/releases"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ✓ PICPIO installation complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Restart VS Code (or open a new terminal)" -ForegroundColor White
Write-Host "  2. Open a folder in VS Code" -ForegroundColor White
Write-Host "  3. Click the PICPIO icon in the sidebar → New Project" -ForegroundColor White
Write-Host ""
Write-Host "  Docs: https://github.com/123him/picpio" -ForegroundColor DarkCyan
Write-Host ""
