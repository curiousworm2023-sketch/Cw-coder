# PICPIO Full Installer for Windows
# Installs: XC8 compiler + MPLAB X IPE + picpio tool + VS Code extension
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main'

$XC8_URL    = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc8-v3.10-full-install-windows-x64-installer.exe'
# Pinned to v6.00 -- newer MPLAB X IPE releases (6.20+) dropped PICkit3 support,
# and picpio.ini defaults `programmer = PICKit3`. Do not bump this without
# checking PICkit3 (-TPPK3) still works in ipecmd.
$MPLABX_URL = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/MPLABX-v6.00-windows-installer.exe'
$NODE_MSI_URL = 'https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi'

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

# Check for the actual compiler/programmer binaries picpio looks for, not just
# the parent install folder -- a partial/aborted install can leave the folder
# behind without the tools picpio needs.
function Test-XC8Installed    { Test-Path "C:\Program Files\Microchip\xc8\v*\bin\xc8-cc.exe" }
function Test-MPLABXInstalled {
    (Test-Path "C:\Program Files\Microchip\MPLABX\v*\mplab_platform\mplab_ipe\ipecmd.exe") -or
    (Test-Path "C:\Program Files\Microchip\MPLABX\v*\mplab_ipe\ipecmd.exe")
}

Write-Host ""
Write-Host "  PICPIO - PIC Microcontroller IDE for VS Code" -ForegroundColor Cyan
Write-Host ""

# STEP 1 - XC8 Compiler
Write-Step 1 "XC8 Compiler (Microchip)"
if (Test-XC8Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc8" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC8 $ver -- skipping"
} else {
    Write-Info "Downloading XC8 compiler (~107 MB)..."
    $xc8Installer = "$env:TEMP\xc8-installer.exe"
    try {
        Invoke-WebRequest $XC8_URL -OutFile $xc8Installer -UseBasicParsing
        Unblock-File $xc8Installer -ErrorAction SilentlyContinue
        Write-Info "Installing XC8 silently (accepts free license; one UAC prompt may appear)..."
        Start-Process $xc8Installer -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        if (-not (Test-XC8Installed)) {
            Write-Warn "Silent install didn't produce a compiler -- opening the XC8 setup wizard."
            Write-Warn "Click through with the default options (Next > Next > I Accept > Next > Install > Finish)."
            Start-Process $xc8Installer -Verb RunAs -Wait
        }
        Remove-Item $xc8Installer -Force -ErrorAction SilentlyContinue
        if (Test-XC8Installed) {
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
if (Test-MPLABXInstalled) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\MPLABX" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: MPLAB X $ver -- skipping"
} else {
    Write-Info "Downloading MPLAB X installer (~640 MB, this may take a while)..."
    $mplabxInstaller = "$env:TEMP\mplabx-installer.exe"
    try {
        Invoke-WebRequest $MPLABX_URL -OutFile $mplabxInstaller -UseBasicParsing
        Unblock-File $mplabxInstaller -ErrorAction SilentlyContinue
        Write-Info "Installing MPLAB X silently (one UAC prompt may appear)..."
        Start-Process $mplabxInstaller -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        if (-not (Test-MPLABXInstalled)) {
            Write-Warn "Silent install didn't produce IPE -- opening the MPLAB X setup wizard."
            Write-Warn "Click through with the default options; the IPE component is enough (you can deselect MPLAB X IDE/compilers)."
            Start-Process $mplabxInstaller -Verb RunAs -Wait
        }
        Remove-Item $mplabxInstaller -Force -ErrorAction SilentlyContinue
        if (Test-MPLABXInstalled) {
            Write-Info "MPLAB X installed."
        } else {
            Write-Warn "MPLAB X install did not complete. Get it at: https://www.microchip.com/mplabx"
        }
    } catch {
        Write-Warn "Download failed. Install manually: https://www.microchip.com/mplabx"
    }
}

# STEP 3 - Node.js (required to run the picpio CLI)
Write-Step 3 "Node.js runtime"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd -or (Test-Path "C:\Program Files\nodejs\node.exe")) {
    $nodeVer = if ($nodeCmd) { & $nodeCmd.Source -v } else { "(installed)" }
    Write-Skip "Already installed: node $nodeVer -- skipping"
} else {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Installing Node.js LTS via winget..."
        try {
            & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent | Out-Null
        } catch {
            Write-Warn "winget install failed: $($_.Exception.Message)"
        }
    }
    if (-not (Test-Path "C:\Program Files\nodejs\node.exe")) {
        Write-Info "Downloading Node.js LTS installer..."
        $nodeMsi = "$env:TEMP\node-lts.msi"
        try {
            Invoke-WebRequest $NODE_MSI_URL -OutFile $nodeMsi -UseBasicParsing
            Unblock-File $nodeMsi -ErrorAction SilentlyContinue
            Write-Info "Installing Node.js silently (one UAC prompt may appear)..."
            Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Verb RunAs -Wait
            Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Warn "Node.js download/install failed: $($_.Exception.Message)"
        }
    }
    if (Test-Path "C:\Program Files\nodejs\node.exe") {
        Write-Info "Node.js installed."
    } else {
        Write-Warn "Node.js install did not complete. picpio requires Node.js: https://nodejs.org"
    }
}

# STEP 4 - PICPIO tool
Write-Step 4 "PICPIO tool"
New-Item -ItemType Directory -Force $INSTALL_DIR | Out-Null
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.js"  -OutFile "$INSTALL_DIR\picpio.js"  -UseBasicParsing
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.cmd" -OutFile "$INSTALL_DIR\picpio.cmd" -UseBasicParsing
Unblock-File "$INSTALL_DIR\picpio.js"  -ErrorAction SilentlyContinue
Unblock-File "$INSTALL_DIR\picpio.cmd" -ErrorAction SilentlyContinue
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

# STEP 5 - PATH
Write-Step 5 "System PATH"
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

# Make picpio/node available in already-open shells (e.g. an existing VS Code
# window) too, since registry PATH changes only apply to brand-new processes.
$profileDir = Split-Path $PROFILE -Parent
New-Item -ItemType Directory -Force $profileDir | Out-Null
$pathFix = @"
foreach (`$dir in '$INSTALL_DIR', 'C:\Program Files\nodejs') {
    if ((`$env:Path -split ';') -notcontains `$dir) {
        `$env:Path += ";`$dir"
    }
}
"@
if ((-not (Test-Path $PROFILE)) -or -not (Select-String -Path $PROFILE -Pattern ([regex]::Escape($INSTALL_DIR)) -Quiet)) {
    Add-Content -Path $PROFILE -Value $pathFix
    Write-Info "PowerShell profile updated -- new terminals will see picpio/node immediately"
}

# Make sure the profile script above can actually run. Windows defaults to
# "Restricted", which silently blocks $PROFILE and prints a scary error in
# every new terminal. "RemoteSigned" for the current user fixes this without
# requiring admin rights.
try {
    $currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
    if ($currentPolicy -eq 'Restricted' -or $currentPolicy -eq 'Undefined') {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
        Write-Info "PowerShell execution policy set to RemoteSigned (current user)"
    } else {
        Write-Skip "Execution policy already allows local scripts ($currentPolicy)"
    }
} catch {
    Write-Warn "Could not update execution policy: $($_.Exception.Message)"
    Write-Warn "If new terminals show a profile script error, run:"
    Write-Warn "  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned"
}

# STEP 6 - VS Code extension
Write-Step 6 "VS Code extension"
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

# Final check -- make sure everything picpio needs is actually in place,
# so problems surface here instead of as a confusing "build" error later.
Write-Host ""
Write-Host "  Checking installation..." -ForegroundColor Cyan
$checks = [ordered]@{
    'XC8 compiler'   = Test-XC8Installed
    'MPLAB X IPE'    = Test-MPLABXInstalled
    'Node.js'        = Test-Path "C:\Program Files\nodejs\node.exe"
    'picpio CLI'     = Test-Path "$INSTALL_DIR\picpio.cmd"
}
$allOk = $true
foreach ($name in $checks.Keys) {
    if ($checks[$name]) {
        Write-Host "    [OK]   $name" -ForegroundColor Green
    } else {
        Write-Host "    [MISS] $name" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "  PICPIO installation complete!" -ForegroundColor Cyan
} else {
    Write-Host "  PICPIO installation finished with warnings (see [MISS] above)." -ForegroundColor Yellow
    Write-Host "  Re-run this same command to retry the missing piece(s)." -ForegroundColor Yellow
}
Write-Host "  1. Close and reopen VS Code / the terminal" -ForegroundColor White
Write-Host "  2. PICPIO icon in sidebar > New Project" -ForegroundColor White
Write-Host "  Docs: https://github.com/curiousworm2023-sketch/Cw-coder" -ForegroundColor DarkCyan
Write-Host ""
