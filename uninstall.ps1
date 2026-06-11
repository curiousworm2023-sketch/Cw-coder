# PICPIO Uninstaller for Windows
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/uninstall.ps1)
#
# Removes the PICPIO VS Code extension, the picpio CLI, its PATH/profile
# entries, and (optionally, with confirmation) the XC8 compiler, MPLAB X
# IPE, and Node.js installed by install.ps1.

$INSTALL_DIR = 'C:\picpio'

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

function Invoke-Uninstaller($exe) {
    try {
        Start-Process $exe -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
    } catch {
        Write-Warn "Silent uninstall failed, opening uninstaller wizard..."
        Start-Process $exe -Verb RunAs -Wait
    }
}

Write-Host ""
Write-Host "  PICPIO Uninstaller" -ForegroundColor Cyan
Write-Host ""

# STEP 1 - VS Code extension
Write-Step 1 "VS Code extension"
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
    & $codeCmd --uninstall-extension picpio.picpio | Out-Null
    Write-Info "Extension removed (if it was installed)"
} else {
    Write-Skip "VS Code not found -- skipping"
}

# STEP 2 - picpio CLI
Write-Step 2 "picpio CLI"
if (Test-Path $INSTALL_DIR) {
    Remove-Item -Recurse -Force $INSTALL_DIR
    Write-Info "Removed $INSTALL_DIR"
} else {
    Write-Skip "$INSTALL_DIR not found -- skipping"
}

# STEP 3 - PATH entries
Write-Step 3 "PATH entries"
foreach ($scope in 'Machine','User') {
    try {
        $p = [System.Environment]::GetEnvironmentVariable('PATH', $scope)
        if ($p -and (($p -split ';') -contains $INSTALL_DIR)) {
            $new = (($p -split ';') | Where-Object { $_ -and $_ -ne $INSTALL_DIR }) -join ';'
            [System.Environment]::SetEnvironmentVariable('PATH', $new, $scope)
            Write-Info "Removed $INSTALL_DIR from $scope PATH"
        } else {
            Write-Skip "$scope PATH does not contain $INSTALL_DIR"
        }
    } catch {
        Write-Warn "Could not update $scope PATH: $($_.Exception.Message)"
    }
}

# STEP 4 - PowerShell profile fixup
Write-Step 4 "PowerShell profile"
if (Test-Path $PROFILE) {
    $content = Get-Content $PROFILE -Raw
    if ($content -match [regex]::Escape($INSTALL_DIR)) {
        $pattern = "(?ms)^foreach\s*\(\`$dir in '$([regex]::Escape($INSTALL_DIR))'.*?\r?\n\}\r?\n?"
        $newContent = [regex]::Replace($content, $pattern, '')
        Set-Content -Path $PROFILE -Value $newContent
        Write-Info "Removed picpio PATH fixup from $PROFILE"
    } else {
        Write-Skip "Profile does not reference $INSTALL_DIR"
    }
} else {
    Write-Skip "No PowerShell profile found"
}

# STEP 5 - optional: full toolchain (XC8 / MPLAB X / Node.js)
Write-Step 5 "Toolchain (XC8 / MPLAB X / Node.js)"
Write-Host "    These are shared dev tools other projects may also use." -ForegroundColor DarkGray
$resp = Read-Host "    Also uninstall XC8 compiler, MPLAB X IPE, and Node.js? [y/N]"
if ($resp -match '^[Yy]') {
    $xc8Uninst = Get-ChildItem "C:\Program Files\Microchip\xc8\v*\Uninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($xc8Uninst) {
        Write-Info "Uninstalling XC8 (one UAC prompt may appear)..."
        Invoke-Uninstaller $xc8Uninst.FullName
    } else {
        Write-Skip "XC8 not found"
    }

    $mplabxUninst = Get-ChildItem "C:\Program Files\Microchip\MPLABX\v*\Uninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mplabxUninst) {
        Write-Info "Uninstalling MPLAB X IPE (one UAC prompt may appear)..."
        Invoke-Uninstaller $mplabxUninst.FullName
    } else {
        Write-Skip "MPLAB X not found"
    }

    if (Test-Path "C:\Program Files\nodejs\node.exe") {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Info "Uninstalling Node.js via winget..."
            try {
                & winget uninstall -e --id OpenJS.NodeJS.LTS --silent | Out-Null
            } catch {
                Write-Warn "winget uninstall failed: $($_.Exception.Message)"
                Write-Warn "Remove Node.js manually from Settings > Apps"
            }
        } else {
            Write-Warn "winget not found. Remove Node.js manually from Settings > Apps"
        }
    } else {
        Write-Skip "Node.js not found"
    }
} else {
    Write-Skip "Leaving XC8 / MPLAB X / Node.js installed"
}

Write-Host ""
Write-Host "  PICPIO uninstall complete." -ForegroundColor Cyan
Write-Host "  Close and reopen any open terminals/VS Code windows." -ForegroundColor White
Write-Host ""
