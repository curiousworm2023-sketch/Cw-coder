# PICPIO Full Installer for Windows
# Installs the PICPIO tool + VS Code extension + Node.js, and guides you to
# install Microchip's free XC8 compiler and MPLAB X (IPE/MDB) directly from
# Microchip. We intentionally do NOT auto-download Microchip's installers --
# you download them from Microchip's own site, under Microchip's own license.
#
# One-liner:
#   iex (irm https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/install.ps1)

$ErrorActionPreference = 'Stop'
$INSTALL_DIR = 'C:\picpio'
$REPO_RAW    = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main'

# Official Microchip download PAGES (not direct CDN links). The user downloads
# the free installers themselves from Microchip -- the clean, terms-compliant way.
$XC8_PAGE    = 'https://www.microchip.com/en-us/tools-resources/develop/mplab-xc-compilers/xc8#downloads'
$XC16_PAGE   = 'https://www.microchip.com/en-us/tools-resources/develop/mplab-xc-compilers/xc16#downloads'
$XC32_PAGE   = 'https://www.microchip.com/en-us/tools-resources/develop/mplab-xc-compilers/xc32#downloads'
$MPLABX_PAGE = 'https://www.microchip.com/en-us/tools-resources/develop/mplab-x-ide#downloads'
$NODE_MSI_URL = 'https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi'

# Tracks Microchip tools the user still needs to install by hand.
$script:NeedsManual = @()

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Green }
function Write-Info($msg)      { Write-Host "    $msg"  -ForegroundColor White }
function Write-Skip($msg)      { Write-Host "    $msg"  -ForegroundColor DarkGray }
function Write-Warn($msg)      { Write-Host "    $msg"  -ForegroundColor Yellow }

# Guides the user to install a Microchip tool from Microchip's own site. For
# required tools ($open=$true) the official download page is opened in the
# browser; optional ones just print the link. Records it so `picpio doctor`
# (and the final summary) can confirm it afterwards. No auto-download.
function Need-Vendor($name, $page, [bool]$open, [string[]]$notes) {
    Write-Warn "$name -- not installed."
    foreach ($n in $notes) { Write-Info "  - $n" }
    if ($open) {
        Write-Info "Opening Microchip's official download page in your browser..."
        try { Start-Process $page } catch { Write-Info "  $page" }
    } else {
        Write-Info "  Download page: $page"
    }
    $script:NeedsManual += $name
}

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

# STEP 1 - XC8 Compiler (required for PIC10/12/16/18)
Write-Step 1 "XC8 Compiler (Microchip, free)"
if (Test-XC8Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc8" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC8 $ver -- skipping"
} else {
    Need-Vendor 'XC8 compiler' $XC8_PAGE $true @(
        'Required for PIC10/12/16/18 projects (~107 MB).',
        'Download the latest Windows installer and run it.',
        'Choose the FREE license during setup -- no PRO key needed.'
    )
}

# STEP 2 - XC16 Compiler (optional: PIC24 / dsPIC)
Write-Step 2 "XC16 Compiler (PIC24 / dsPIC, Microchip, free)"
if (Test-XC16Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc16" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC16 $ver -- skipping"
} else {
    Need-Vendor 'XC16 compiler (optional)' $XC16_PAGE $false @(
        'Only needed for PIC24 / dsPIC projects -- skip otherwise.',
        'Download the Windows installer from the page and run it.'
    )
}

# STEP 3 - XC32 Compiler (optional: PIC32)
Write-Step 3 "XC32 Compiler (PIC32, Microchip, free)"
if (Test-XC32Installed) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\xc32" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: XC32 $ver -- skipping"
} else {
    Need-Vendor 'XC32 compiler (optional)' $XC32_PAGE $false @(
        'Only needed for PIC32 projects -- skip otherwise.',
        'Download the Windows installer from the page and run it.'
    )
}

# STEP 4 - MPLAB X IPE (required for upload + debug)
Write-Step 4 "MPLAB X (IPE + MDB debugger, Microchip, free)"
if (Test-MPLABXInstalled) {
    $ver = (Get-ChildItem "C:\Program Files\Microchip\MPLABX" | Sort-Object Name -Descending | Select-Object -First 1).Name
    Write-Skip "Already installed: MPLAB X $ver -- skipping"
} else {
    Need-Vendor 'MPLAB X (IPE/MDB)' $MPLABX_PAGE $true @(
        'Provides ipecmd (flash) and mdb (the on-chip debugger).',
        'IMPORTANT: install version 6.00 specifically -- open the "Downloads Archive"',
        'and pick MPLAB X v6.00. Newer releases (6.20+) dropped the PICkit 3 support',
        'PICPIO uses. The IPE component alone is enough.'
    )
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

# Final check. Split into what the installer itself set up (must be OK) vs.
# the Microchip tools you install from Microchip (shown as [TODO] if pending).
Write-Host ""
Write-Host "  Checking installation..." -ForegroundColor Cyan

# Installed by this script:
$checks = [ordered]@{
    'Node.js'    = Test-Path "C:\Program Files\nodejs\node.exe"
    'picpio CLI' = Test-Path "$INSTALL_DIR\picpio.cmd"
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

# Microchip tools -- you install these from Microchip (pages opened above).
Write-Host ""
Write-Host "  Microchip tools (install from Microchip):" -ForegroundColor Cyan
$mchp = [ordered]@{
    'XC8 compiler (PIC10/12/16/18)' = (Test-XC8Installed),    $true
    'MPLAB X (IPE + MDB debugger)'  = (Test-MPLABXInstalled), $true
    'XC16 compiler (PIC24/dsPIC)'   = (Test-XC16Installed),   $false
    'XC32 compiler (PIC32)'         = (Test-XC32Installed),   $false
}
foreach ($name in $mchp.Keys) {
    $present  = $mchp[$name][0]
    $required = $mchp[$name][1]
    if ($present) {
        Write-Host "    [OK]   $name" -ForegroundColor Green
    } elseif ($required) {
        Write-Host "    [TODO] $name -- install from Microchip" -ForegroundColor Yellow
    } else {
        Write-Host "    [ --]  $name (optional -- only if you target these)" -ForegroundColor DarkGray
    }
}

Write-Host ""
if ($allOk -and $script:NeedsManual.Count -eq 0) {
    Write-Host "  PICPIO installation complete!" -ForegroundColor Cyan
} elseif ($allOk) {
    Write-Host "  PICPIO is installed. Finish by installing the Microchip tool(s) marked [TODO]" -ForegroundColor Yellow
    Write-Host "  above (the download pages were opened in your browser), then confirm with:" -ForegroundColor Yellow
    Write-Host "      picpio doctor" -ForegroundColor White
} else {
    Write-Host "  PICPIO installation finished with warnings (see [MISS] above)." -ForegroundColor Yellow
    Write-Host "  Re-run this same command to retry the missing piece(s)." -ForegroundColor Yellow
}
Write-Host "  1. Install any [TODO] Microchip tools, then close & reopen VS Code / the terminal" -ForegroundColor White
Write-Host "  2. Run 'picpio doctor' to verify the toolchain" -ForegroundColor White
Write-Host "  3. PICPIO icon in sidebar > New Project" -ForegroundColor White
Write-Host "  Docs: https://github.com/curiousworm2023-sketch/Cw-coder" -ForegroundColor DarkCyan
Write-Host ""
