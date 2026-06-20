# PICPIO Full Installer for Windows
# Installs: XC8 compiler + MPLAB X IPE + picpio tool + VS Code extension
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main'

$XC8_URL    = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc8-v3.10-full-install-windows-x64-installer.exe'
# XC16 = PIC24 / dsPIC (16-bit). v2.10 is the final XC16 release. NOTE: Microchip
# now serves this only behind its browser "filehandler" (direct download 403s),
# so the auto-download usually fails and the script falls back to a manual link.
$XC16_URL   = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc16-v2.10-full-install-windows-x64-installer.exe'
$XC16_PAGE  = 'https://www.microchip.com/en-us/tools-resources/develop/mplab-xc-compilers/xc16'
# XC32 = PIC32 (32-bit). Direct download works.
$XC32_URL   = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/xc32-v4.35-full-install-windows-x64-installer.exe'
# Pinned to v6.00 -- newer MPLAB X IPE releases (6.20+) dropped PICkit3 support,
# and picpio.ini defaults `programmer = PICKit3`. Do not bump this without
# checking PICkit3 (-TPPK3) still works in ipecmd.
$MPLABX_URL = 'https://ww1.microchip.com/downloads/aemDocuments/documents/DEV/ProductDocuments/SoftwareTools/MPLABX-v6.00-windows-installer.exe'
$NODE_MSI_URL = 'https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi'

# ww1.microchip.com hotlink-protects these installers (returns 401/403
# without a Referer from microchip.com), even though browsers download
# them fine.
$MICROCHIP_HEADERS = @{ 'Referer' = 'https://www.microchip.com/' }

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

# Downloads $url to $out, streaming with a single-line progress readout in MB
# (e.g. "  42.0 MB / 107.3 MB"). $headers is an optional hashtable of request
# headers (used for the Microchip Referer). Falls back to Invoke-WebRequest if
# the streaming download isn't available. Throws on HTTP errors so callers can
# fall back to a manual link.
function Save-Url($url, $out, $headers) {
    $ProgressPreference = 'SilentlyContinue'
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $true
        $client  = New-Object System.Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromMinutes(30)
        if ($headers) { foreach ($k in $headers.Keys) { [void]$client.DefaultRequestHeaders.TryAddWithoutValidation($k, $headers[$k]) } }

        $resp = $client.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $resp.IsSuccessStatusCode) { $client.Dispose(); throw "HTTP $([int]$resp.StatusCode) $($resp.ReasonPhrase)" }

        $total    = $resp.Content.Headers.ContentLength
        $totalMB  = if ($total) { [math]::Round($total / 1MB, 1) } else { $null }
        $inStream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outFile  = [System.IO.File]::Create($out)
        try {
            $buffer = New-Object byte[] (1MB)
            $sum = 0L; $lastShownMB = -10
            while (($read = $inStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $outFile.Write($buffer, 0, $read)
                $sum += $read
                $mb = [math]::Round($sum / 1MB, 1)
                if (($mb - $lastShownMB) -ge 5 -or ($total -and $sum -ge $total)) {
                    $lastShownMB = $mb
                    if ($totalMB) { $line = "    {0,8:N1} MB / {1,8:N1} MB" -f $mb, $totalMB } else { $line = "    {0,8:N1} MB" -f $mb }
                    Write-Host ("`r$line") -NoNewline -ForegroundColor DarkGray
                }
            }
        } finally {
            $outFile.Close(); $inStream.Close(); $client.Dispose()
        }
        Write-Host ""   # finish the progress line
    } catch {
        Write-Host ""
        # Streaming failed (or unsupported) -- retry once with Invoke-WebRequest.
        $h = if ($headers) { $headers } else { @{} }
        Invoke-WebRequest $url -OutFile $out -Headers $h -UseBasicParsing
    }
}

# Check for the actual compiler/programmer binaries picpio looks for, not just
# the parent install folder -- a partial/aborted install can leave the folder
# behind without the tools picpio needs.
function Test-XC8Installed    { Test-Path "C:\Program Files\Microchip\xc8\v*\bin\xc8-cc.exe" }
function Test-XC16Installed   { Test-Path "C:\Program Files\Microchip\xc16\v*\bin\xc16-gcc.exe" }
function Test-XC32Installed   { Test-Path "C:\Program Files\Microchip\xc32\v*\bin\xc32-gcc.exe" }
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
        Save-Url $XC8_URL $xc8Installer $MICROCHIP_HEADERS
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
        Write-Warn "Download/install failed: $($_.Exception.Message)"
        Write-Warn "Install manually: https://www.microchip.com/xc8"
    }
}

# STEP 2 - XC16 Compiler (PIC24 / dsPIC)
Write-Step 2 "XC16 Compiler (PIC24 / dsPIC, Microchip)"
if (Test-XC16Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc16" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC16 $ver -- skipping"
} else {
    Write-Info "Downloading XC16 compiler (~300 MB)..."
    $xc16Installer = "$env:TEMP\xc16-installer.exe"
    try {
        Save-Url $XC16_URL $xc16Installer $MICROCHIP_HEADERS
        Unblock-File $xc16Installer -ErrorAction SilentlyContinue
        Write-Info "Installing XC16 silently (one UAC prompt may appear)..."
        Start-Process $xc16Installer -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        if (-not (Test-XC16Installed)) {
            Write-Warn "Silent install didn't produce a compiler -- opening the XC16 setup wizard."
            Start-Process $xc16Installer -Verb RunAs -Wait
        }
        Remove-Item $xc16Installer -Force -ErrorAction SilentlyContinue
        if (Test-XC16Installed) { Write-Info "XC16 installed." }
        else { Write-Warn "XC16 install did not complete. Get it at: $XC16_PAGE" }
    } catch {
        # Microchip serves XC16 only behind its browser filehandler, so the
        # direct download commonly fails -- point the user at the download page.
        Write-Warn "Auto-download failed (Microchip serves XC16 via a browser only)."
        Write-Warn "Install it manually (needed only for PIC24/dsPIC projects):"
        Write-Warn "  $XC16_PAGE"
    }
}

# STEP 3 - XC32 Compiler (PIC32)
Write-Step 3 "XC32 Compiler (PIC32, Microchip)"
if (Test-XC32Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc32" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC32 $ver -- skipping"
} else {
    Write-Info "Downloading XC32 compiler (~445 MB)..."
    $xc32Installer = "$env:TEMP\xc32-installer.exe"
    try {
        Save-Url $XC32_URL $xc32Installer $MICROCHIP_HEADERS
        Unblock-File $xc32Installer -ErrorAction SilentlyContinue
        Write-Info "Installing XC32 silently (one UAC prompt may appear)..."
        Start-Process $xc32Installer -ArgumentList '--mode unattended --unattendedmodeui minimal' -Verb RunAs -Wait
        if (-not (Test-XC32Installed)) {
            Write-Warn "Silent install didn't produce a compiler -- opening the XC32 setup wizard."
            Start-Process $xc32Installer -Verb RunAs -Wait
        }
        Remove-Item $xc32Installer -Force -ErrorAction SilentlyContinue
        if (Test-XC32Installed) { Write-Info "XC32 installed." }
        else { Write-Warn "XC32 install did not complete. Get it at: https://www.microchip.com/xc32" }
    } catch {
        Write-Warn "Download/install failed: $($_.Exception.Message)"
        Write-Warn "Install manually (needed only for PIC32 projects): https://www.microchip.com/xc32"
    }
}

# STEP 4 - MPLAB X IPE
Write-Step 4 "MPLAB X IPE (programmer software)"
if (Test-MPLABXInstalled) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\MPLABX" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: MPLAB X $ver -- skipping"
} else {
    Write-Info "Downloading MPLAB X installer (~640 MB, this may take a while)..."
    $mplabxInstaller = "$env:TEMP\mplabx-installer.exe"
    try {
        Save-Url $MPLABX_URL $mplabxInstaller $MICROCHIP_HEADERS
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
        Write-Warn "Download/install failed: $($_.Exception.Message)"
        Write-Warn "Install manually: https://www.microchip.com/mplabx"
    }
}

# STEP 5 - Node.js (required to run the picpio CLI)
Write-Step 5 "Node.js runtime"
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
            Save-Url $NODE_MSI_URL $nodeMsi $null
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

# STEP 6 - PICPIO tool
Write-Step 6 "PICPIO tool"
New-Item -ItemType Directory -Force $INSTALL_DIR | Out-Null
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.js"  -OutFile "$INSTALL_DIR\picpio.js"  -UseBasicParsing
Invoke-WebRequest "$REPO_RAW/picpio_tool/picpio.cmd" -OutFile "$INSTALL_DIR\picpio.cmd" -UseBasicParsing
Unblock-File "$INSTALL_DIR\picpio.js"  -ErrorAction SilentlyContinue
Unblock-File "$INSTALL_DIR\picpio.cmd" -ErrorAction SilentlyContinue
Write-Info "picpio.js -> $INSTALL_DIR"

$acDir = "$INSTALL_DIR\picpio_compat"
New-Item -ItemType Directory -Force $acDir | Out-Null
foreach ($f in @('Picpio.h','wiring.c','main_entry.c')) {
    try {
        Invoke-WebRequest "$REPO_RAW/picpio-vscode/picpio_compat/$f" -OutFile "$acDir\$f" -UseBasicParsing
        Write-Info "  downloaded: $f"
    } catch {
        Write-Skip "  skipped: $f"
    }
}

# Bundled libraries + the extra HAL variants for non-K40 PIC families. These are
# whole folders, so rather than hardcode every file we list the repo once via
# the GitHub tree API and pull each file from raw (raw downloads aren't rate
# limited). Without this, `lib add` has nothing to copy and non-K40 MCUs have no
# HAL on a fresh install.
$REPO_API = 'https://api.github.com/repos/curiousworm2023-sketch/Cw-coder/git/trees/main?recursive=1'
$repoTree = $null
try {
    $repoTree = (Invoke-RestMethod $REPO_API -Headers @{ 'User-Agent' = 'picpio-installer' } -UseBasicParsing).tree
} catch {
    Write-Warn "Could not list repo via GitHub API: $($_.Exception.Message)"
    Write-Warn "Libraries / extra HAL variants may be missing -- re-run later or 'picpio update'."
}

function Save-RepoTree($prefix, $destBase) {
    if (-not $repoTree) { return 0 }
    $blobs = $repoTree | Where-Object { $_.type -eq 'blob' -and $_.path -like "$prefix/*" }
    foreach ($b in $blobs) {
        $rel  = $b.path.Substring($prefix.Length + 1)
        $dest = Join-Path $destBase $rel
        New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
        try { Invoke-WebRequest "$REPO_RAW/$($b.path)" -OutFile $dest -UseBasicParsing }
        catch { Write-Skip "  skipped: $($b.path)" }
    }
    return ($blobs | Measure-Object).Count
}

if ($repoTree) {
    [void](Save-RepoTree 'picpio_tool/libraries' "$INSTALL_DIR\libraries")
    $libCount = if (Test-Path "$INSTALL_DIR\libraries") { (Get-ChildItem -Directory "$INSTALL_DIR\libraries").Count } else { 0 }
    Write-Info "Bundled libraries -> $INSTALL_DIR\libraries ($libCount libraries)"

    foreach ($variant in 'picpio_compat_pic16','picpio_compat_pic16f1','picpio_compat_pic18_classic','picpio_compat_pic24','picpio_compat_pic30f','picpio_compat_dspic33e') {
        [void](Save-RepoTree "picpio_tool/$variant" "$INSTALL_DIR\$variant")
    }
    Write-Info "HAL variants for PIC16/PIC18-classic/PIC24/dsPIC installed"
}

# STEP 7 - PATH
Write-Step 7 "System PATH"
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

# STEP 8 - VS Code extension
Write-Step 8 "VS Code extension"
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

# Optional compilers -- only needed for PIC24/dsPIC (XC16) or PIC32 (XC32)
# projects, so a missing one is informational, not a failure.
$optional = [ordered]@{
    'XC16 compiler (PIC24/dsPIC)' = Test-XC16Installed
    'XC32 compiler (PIC32)'       = Test-XC32Installed
}
foreach ($name in $optional.Keys) {
    if ($optional[$name]) {
        Write-Host "    [OK]   $name" -ForegroundColor Green
    } else {
        Write-Host "    [ --]  $name (optional -- install only if you target these)" -ForegroundColor DarkGray
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
