# PICPIO Full Installer for Windows
# Installs: XC8 compiler + MPLAB X IPE + picpio tool + VS Code extension
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main'

$XC8_URL    = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc8-v3.10-full-install-windows-x64-installer.exe'
$MPLABX_URL = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/MPLABX-v6.00-windows-installer.exe'

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

Write-Host ""
Write-Host "  PICPIO - PIC Microcontroller IDE for VS Code" -ForegroundColor Cyan
Write-Host ""

# STEP 1 - XC8 Compiler
Write-Step 1 "XC8 Compiler (Microchip)"
if (Test-Path "C:\Program Files\Microchip\xc8") {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc8" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC8 $ver -- skipping"
} else {
    Write-Info "Downloading XC8 compiler (~107 MB)..."
    $xc8Installer = "$env:TEMP\xc8-installer.exe"
    try {
        Invoke-WebRequest $XC8_URL -OutFile $xc8Installer -UseBasicParsing
        Write-Info "Installing XC8 silently (accepts free license; one UAC prompt may appear)..."
        Start-Process $xc8Installer -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        Remove-Item $xc8Installer -Force -ErrorAction SilentlyContinue
        if (Test-Path "C:\Program Files\Microchip\xc8") {
            Write-Info "XC8 installed."
        } else {
            Write-Warn "XC8 install did not complete. Get it at: https://www.microchip.com/xc8"
        }
    } catch {
        Write-Warn "Download failed. Install manually: https://www.microchip.com/xc8"
    }
}

# STEP 2 - MPLAB X IPE
Write-Step 2 "MPLAB X IPE (programmer software)"
if (Test-Path "C:\Program Files\Microchip\MPLABX") {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\MPLABX" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: MPLAB X $ver -- skipping"
} else {
    Write-Info "Downloading MPLAB X installer (~640 MB, this may take a while)..."
    $mplabxInstaller = "$env:TEMP\mplabx-installer.exe"
    try {
        Invoke-WebRequest $MPLABX_URL -OutFile $mplabxInstaller -UseBasicParsing
        Write-Info "Installing MPLAB X silently (one UAC prompt may appear)..."
        Start-Process $mplabxInstaller -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        Remove-Item $mplabxInstaller -Force -ErrorAction SilentlyContinue
        if (Test-Path "C:\Program Files\Microchip\MPLABX") {
            Write-Info "MPLAB X installed."
        } else {
            Write-Warn "MPLAB X install did not complete. Get it at: https://www.microchip.com/mplabx"
        }
    } catch {
        Write-Warn "Download failed. Install manually: https://www.microchip.com/mplabx"
    }
}

# STEP 3 - PICPIO tool
Write-Step 3 "PICPIO tool"
New-Item -ItemType Directory -Force $INSTALL_DIR | Out-Null
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.js"  -OutFile "$INSTALL_DIR\picpio.js"  -UseBasicParsing
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.cmd" -OutFile "$INSTALL_DIR\picpio.cmd" -UseBasicParsing
Write-Info "picpio.js -> $INSTALL_DIR"

$acDir = "$INSTALL_DIR\arduino_compat"
New-Item -ItemType Directory -Force $acDir | Out-Null
foreach ($f in @('Arduino.h','wiring.c','main_entry.c')) {
    try {
        Invoke-WebRequest "$REPO_RAW/picpio-vscode/arduino_compat/$f" -OutFile "$acDir\$f" -UseBasicParsing
        Write-Info "  downloaded: $f"
    } catch {
        Write-Skip "  skipped: $f"
    }
}

# STEP 4 - PATH
Write-Step 4 "System PATH"
$machine = [System.Environment]::GetEnvironmentVariable('PATH','Machine')
if ($machine -notlike "*$INSTALL_DIR*") {
    try {
        [System.Environment]::SetEnvironmentVariable('PATH',"$machine;$INSTALL_DIR",'Machine')
        Write-Info "Added to system PATH"
    } catch {
        $user = [System.Environment]::GetEnvironmentVariable('PATH','User')
        if ($user -notlike "*$INSTALL_DIR*") {
            [System.Environment]::SetEnvironmentVariable('PATH',"$user;$INSTALL_DIR",'User')
        }
        Write-Warn "Added to user PATH (run as admin for system PATH)"
    }
} else {
    Write-Skip "Already in PATH"
}

# STEP 5 - VS Code extension
Write-Step 5 "VS Code extension"
$_gc = Get-Command code -ErrorAction SilentlyContinue
$codeCmd = if ($_gc) { $_gc.Source } else { $null }
if (-not $codeCmd) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        "C:\Program Files\Microsoft VS Code\bin\code.cmd"
    )
    $codeCmd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($codeCmd) {
    $vsix = "$env:TEMP\picpio.vsix"
    try {
        Invoke-WebRequest "$REPO_RAW/picpio-vscode/picpio.vsix" -OutFile $vsix -UseBasicParsing
        & $codeCmd --install-extension $vsix
        Write-Info "Extension installed in VS Code"
    } catch {
        Write-Warn "Could not auto-install extension."
        Write-Warn "Get picpio.vsix from: https://github.com/curiousworm2023-sketch/Cw-coder"
        Write-Warn "VS Code: Extensions > ... > Install from VSIX"
    }
} else {
    Write-Warn "VS Code not found. Install from https://code.visualstudio.com"
    Write-Warn "Then install extension from: https://github.com/curiousworm2023-sketch/Cw-coder"
}

Write-Host ""
Write-Host "  PICPIO installation complete!" -ForegroundColor Cyan
Write-Host "  1. Restart VS Code" -ForegroundColor White
Write-Host "  2. PICPIO icon in sidebar > New Project" -ForegroundColor White
Write-Host "  Docs: https://github.com/curiousworm2023-sketch/Cw-coder" -ForegroundColor DarkCyan
Write-Host ""
