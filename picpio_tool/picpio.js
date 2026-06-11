#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const os   = require('os');

// DFP pack storage (used by resolvePack/findDFP/cmdInstallDFP below)
const PACKS_DIR             = 'C:\\picpio\\packs';
const PACK_INDEX_PATH       = path.join(PACKS_DIR, 'index.idx');
const PACK_INDEX_URL        = 'https://packs.download.microchip.com/index.idx';
const DFP_MANIFEST_PATH     = path.join(PACKS_DIR, 'manifest.json');
const PACK_INDEX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') { printHelp(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log('picpio 1.0.0'); process.exit(0); }

switch (cmd) {
    case 'build':   cmdBuild(args.slice(1));  break;
    case 'upload':  cmdUpload(args.slice(1)); break;
    case 'clean':   cmdClean();               break;
    case 'monitor': cmdMonitor();             break;
    case 'init':    cmdInit(args.slice(1));   break;
    case 'lib':          cmdLib(args.slice(1));    break;
    case 'vscode':       cmdVscode();              break;
    case 'erase':        cmdErase();               break;
    case 'install-dfp':  cmdInstallDFP(args[1]);   break;
    default:
        console.error(`[PICPIO] Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function printHelp() {
    console.log(`
PICPIO - PIC Microcontroller Build Tool v1.0.0

Usage: picpio <command> [options]

Commands:
  build         Compile the project
  build -v      Verbose build output
  build --size  Show memory usage after build
  upload        Flash firmware to device
  clean         Delete build artifacts
  monitor       Open serial monitor
  lib add       <name|github:user/repo|https://url>
  lib remove    <name>
  lib list      List installed libraries
  lib update    Update library registry
  init          Create a new project (use --name --mcu --family etc.)
  vscode        Generate .vscode/tasks.json and c_cpp_properties.json
  install-dfp [device|pack]  Download a Device Family Pack.
                Defaults to the [project] mcu in picpio.ini.
                Accepts any device part number (e.g. PIC16F877A)
                or DFP pack name (e.g. PIC16Fxxx_DFP).
`);
}

// ─── CONFIG PARSER ───────────────────────────────────────────────────────────
function readIni(file) {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const cfg   = {};
    for (const line of lines) {
        const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
        if (m) cfg[m[1].trim()] = m[2].trim();
    }
    return cfg;
}

function requireConfig() {
    const ini = path.join(process.cwd(), 'picpio.ini');
    const cfg = readIni(ini);
    if (!cfg) {
        console.error('[PICPIO] No picpio.ini found in current directory.');
        console.error('         Run "picpio init" to create a new project.');
        process.exit(1);
    }
    return cfg;
}

// ─── TOOLCHAIN FINDER ────────────────────────────────────────────────────────
function findXC8() {
    const base = 'C:\\Program Files\\Microchip\\xc8';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc8-cc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc8-cc.exe') : null;
}

// ─── DFP RESOLUTION (Microchip Packs Index) ──────────────────────────────────
// picpio can install the DFP for ANY Microchip device by downloading and
// querying the official pack index, instead of relying on a hardcoded list.

function loadDFPManifest() {
    try { return JSON.parse(fs.readFileSync(DFP_MANIFEST_PATH, 'utf8')); } catch { return {}; }
}

function saveDFPManifest(manifest) {
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    fs.writeFileSync(DFP_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// Download (or reuse a cached copy of) Microchip's full pack index, used to
// resolve any device name to its Device Family Pack name + latest version.
function ensurePackIndex() {
    if (fs.existsSync(PACK_INDEX_PATH)) {
        const age = Date.now() - fs.statSync(PACK_INDEX_PATH).mtimeMs;
        if (age < PACK_INDEX_MAX_AGE_MS) return PACK_INDEX_PATH;
    }
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    console.log('[PICPIO] Fetching Microchip pack index (one-time, ~40MB)...');
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${PACK_INDEX_URL}' -OutFile '${PACK_INDEX_PATH}' -UseBasicParsing"`,
        [], { shell: true, stdio: 'inherit', timeout: 180000 }
    );
    if (result.status !== 0 || !fs.existsSync(PACK_INDEX_PATH)) return null;
    return PACK_INDEX_PATH;
}

// Resolve `name` to a DFP: either a device part number (e.g. "PIC16F877A",
// found by searching every pack's device list) or a DFP pack name itself
// (e.g. "PIC16Fxxx_DFP", matched directly). Returns { name, version } or null.
function resolvePack(name) {
    const idxPath = ensurePackIndex();
    if (!idxPath) return null;
    const data   = fs.readFileSync(idxPath, 'utf8');
    const target = name.toUpperCase();
    const blocks = data.split(/(?=<pdsc )/);
    for (const block of blocks) {
        if (!block.startsWith('<pdsc ')) continue;
        const nameM = block.match(/atmel:name="([^"]+)"/);
        if (!nameM || !/_DFP$/.test(nameM[1])) continue;
        const verM = block.match(/^<pdsc[^>]*\sversion="([^"]+)"/);
        if (!verM) continue;
        if (nameM[1].toUpperCase() === target) return { name: nameM[1], version: verM[1] };
        const re = new RegExp(`<atmel:device name="${target}"`, 'i');
        if (re.test(block)) return { name: nameM[1], version: verM[1] };
    }
    return null;
}

// Download + extract a pack by exact name/version into C:\picpio\packs\<name>
function downloadPack(name, version) {
    const destDir = path.join(PACKS_DIR, name);
    fs.mkdirSync(destDir, { recursive: true });
    const url = `https://packs.download.microchip.com/Microchip.${name}.${version}.atpack`;
    const tmp = path.join(os.tmpdir(), `${name}_${version}.zip`);
    console.log(`[PICPIO] Downloading ${name} v${version}...`);
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmp}' -UseBasicParsing"`,
        [], { shell: true, stdio: 'inherit', timeout: 180000 }
    );
    if (result.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 10000) {
        console.log('[PICPIO] Extracting...');
        cp.spawnSync(
            `powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${destDir}' -Force"`,
            [], { shell: true, stdio: 'inherit' }
        );
        fs.rmSync(tmp, { force: true });
        return destDir;
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    fs.rmSync(destDir, { recursive: true, force: true });
    return null;
}

// XC8 v3.x / XC16 v2.x require a DFP for device-specific headers/linker scripts.
// Search order: manifest (from a previous "picpio install-dfp") → family-name
// guess → MPLAB X packs → ~/.mchp_packs → C:\picpio\packs
function findDFP(mcu) {
    const manifest = loadDFPManifest();
    const family = manifest[(mcu || '').toUpperCase()] || dfpFamilyFor(mcu);
    // XC8 needs the xc8/ subdirectory inside the pack
    const xc8Sub = (p) => {
        const sub = path.join(p, 'xc8');
        return fs.existsSync(sub) ? sub : (fs.existsSync(p) ? p : null);
    };
    const candidates = [
        xc8Sub(`C:\\picpio\\packs\\${family}`),
        xc8Sub(`${process.env.USERPROFILE}\\.mchp_packs\\Microchip\\${family}`),
        ...findVersionedDFP(`C:\\Program Files\\Microchip\\MPLABX`, family),
        ...findVersionedDFP(`${process.env.USERPROFILE}\\.mchp_packs\\Microchip`, family),
    ].filter(Boolean);
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return null;
}

// Auto-download the DFP for `mcu` when findDFP() comes up empty, so a fresh
// checkout/build doesn't require a separate "picpio install-dfp" step.
// Returns the resolved DFP path, or null if it couldn't be resolved/downloaded.
function ensureDFP(mcu) {
    const pack = resolvePack(mcu);
    if (!pack) return null;

    const destDir = path.join(PACKS_DIR, pack.name);
    if (!(fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0)) {
        const dir = downloadPack(pack.name, pack.version);
        if (!dir) return null;
        console.log(`[PICPIO] DFP installed: ${dir} (${pack.name} v${pack.version})`);
    }

    const manifest = loadDFPManifest();
    manifest[mcu.toUpperCase()] = pack.name;
    saveDFPManifest(manifest);

    return findDFP(mcu);
}

// Fast offline guess used as a fallback when no manifest entry exists yet.
function dfpFamilyFor(mcu) {
    const u = (mcu || '').toUpperCase();
    if (u.match(/PIC18F\d+K/))   return 'PIC18F-K_DFP';
    if (u.match(/PIC18F\d+J/))   return 'PIC18F-J_DFP';
    if (u.match(/PIC18F/))        return 'PIC18F_DFP';
    if (u.match(/PIC16F1/))       return 'PIC16F1xxxx_DFP';
    if (u.match(/PIC16/))         return 'PIC16Fxxx_DFP';
    if (u.match(/PIC24/))         return 'PIC24F_DFP';
    if (u.match(/DSPIC33/))       return 'dsPIC33_DFP';
    if (u.match(/PIC32MX/))       return 'PIC32MX_DFP';
    if (u.match(/PIC32MZ/))       return 'PIC32MZ_DFP';
    return 'PIC18F-K_DFP';
}

function findVersionedDFP(base, family) {
    if (!fs.existsSync(base)) return [];
    try {
        const name = family || '';
        const dirs = fs.readdirSync(base)
            .filter(d => !name || d.startsWith(name) || d.includes(name))
            .map(d => {
                const full = path.join(base, d);
                if (!fs.statSync(full).isDirectory()) return null;
                const versions = fs.readdirSync(full)
                    .filter(v => /^\d/.test(v))
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                const root = versions.length ? path.join(full, versions[0]) : full;
                // XC8 needs the xc8/ subdirectory inside the DFP pack
                const xc8sub = path.join(root, 'xc8');
                return fs.existsSync(xc8sub) ? xc8sub : root;
            })
            .filter(Boolean);
        return dirs;
    } catch { return []; }
}

function findXC16() {
    const base = 'C:\\Program Files\\Microchip\\xc16';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc16-gcc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc16-gcc.exe') : null;
}

function findXC32() {
    const base = 'C:\\Program Files\\Microchip\\xc32';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc32-gcc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc32-gcc.exe') : null;
}

function findCompiler(family) {
    family = (family || 'PIC18').toUpperCase();
    if (family.startsWith('PIC32') || family === 'PIC32') return findXC32();
    if (family.startsWith('PIC24') || family.startsWith('DSPIC')) return findXC16();
    return findXC8();
}

function findIPE() {
    const base = 'C:\\Program Files\\Microchip\\MPLABX';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v'))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    for (const v of vers) {
        // MPLAB X v6+ moved IPE to mplab_platform/mplab_ipe/
        const candidates = [
            path.join(base, v, 'mplab_platform', 'mplab_ipe', 'ipecmd.exe'),
            path.join(base, v, 'mplab_ipe', 'ipecmd.exe'),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

// ─── SOURCE COLLECTOR ────────────────────────────────────────────────────────
function collectSources(cfg) {
    const sources   = [];
    const includes  = [];
    const tempFiles = [];
    const root      = process.cwd();
    const srcDir    = path.join(root, cfg.src_dir || 'src');
    const libDir    = path.join(root, 'lib');
    const scriptDir = path.dirname(process.argv[1]);
    // arduino_compat: look next to picpio.js (tool-level), never required in project.
    // Classic PIC16F8xx parts (no LATx/ANSELx/PPS) use a separate HAL variant.
    const acName = dfpFamilyFor(cfg.mcu) === 'PIC16Fxxx_DFP' ? 'arduino_compat_pic16' : 'arduino_compat';
    const acDir = [
        path.join(scriptDir, acName),
        path.join(scriptDir, '..', acName),
    ].find(d => fs.existsSync(d)) || path.join(root, acName);

    // src/
    if (fs.existsSync(srcDir)) {
        scanDir(srcDir, sources, tempFiles);
        includes.push(srcDir);
    }

    // include/ (user headers, like PlatformIO)
    const incDir = path.join(root, 'include');
    if (fs.existsSync(incDir)) includes.push(incDir);

    // arduino_compat/ (tool-level, if framework = arduino)
    if ((cfg.framework || '').toLowerCase() === 'arduino' && fs.existsSync(acDir)) {
        scanDir(acDir, sources, tempFiles);
        includes.push(acDir);
    }

    // lib/*/ (project-local libraries)
    if (fs.existsSync(libDir)) {
        for (const entry of fs.readdirSync(libDir)) {
            const d = path.join(libDir, entry);
            if (fs.statSync(d).isDirectory()) {
                scanDir(d, sources, tempFiles);
                includes.push(d);
            }
        }
    }

    // lib_extra_dirs (shared/external library paths, like PlatformIO)
    const extraRaw = (cfg.lib_extra_dirs || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const extraRoot of extraRaw) {
        if (!fs.existsSync(extraRoot)) {
            console.warn(`[PICPIO] lib_extra_dirs: path not found — ${extraRoot}`);
            continue;
        }
        for (const entry of fs.readdirSync(extraRoot)) {
            const d = path.join(extraRoot, entry);
            if (fs.statSync(d).isDirectory()) {
                scanDir(d, sources, tempFiles);
                includes.push(d);
            }
        }
    }

    return { sources, includes, tempFiles };
}

function scanDir(dir, out, tempOut) {
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            scanDir(full, out, tempOut);
        } else if (/\.cpp$/i.test(f)) {
            // XC8 does not support .cpp — compile a temporary .c copy, then delete it
            const renamed = full.replace(/\.cpp$/i, '.c');
            fs.copyFileSync(full, renamed);
            out.push(renamed);
            if (tempOut) tempOut.push(renamed);
        } else if (/\.c$/i.test(f)) {
            out.push(full);
        }
    }
}

// ─── BUILD ────────────────────────────────────────────────────────────────────
function cmdBuild(opts) {
    const verbose  = opts.includes('-v') || opts.includes('--verbose');
    const showSize = opts.includes('--size');

    // Auto-generate .vscode/c_cpp_properties.json if missing (enables Ctrl+Click)
    if (!fs.existsSync(path.join(process.cwd(), '.vscode', 'c_cpp_properties.json'))) {
        cmdVscode();
    }

    const cfg      = requireConfig();
    const family   = (cfg.family || 'PIC18').toUpperCase();
    const mcu      = cfg.mcu || 'PIC18F27K40';
    const clock    = cfg.clock_hz || '64000000';
    const optLevel = cfg.opt_level || '2';
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');

    const compiler = findCompiler(family);
    if (!compiler) {
        console.error(`[PICPIO] Compiler not found for family ${family}.`);
        console.error(`         Install XC8/XC16/XC32 from https://www.microchip.com/xc`);
        process.exit(1);
    }

    fs.mkdirSync(buildDir, { recursive: true });

    const { sources, includes, tempFiles } = collectSources(cfg);

    if (!sources.length) {
        console.error('[PICPIO] No source files found in src/ or lib/');
        process.exit(1);
    }

    const outHex  = path.join(buildDir, (cfg.name || 'firmware') + '.hex');
    const outElf  = path.join(buildDir, (cfg.name || 'firmware') + '.elf');

    const incFlags = includes.map(i => `-I"${i}"`).join(' ');

    // DFP flag (required by XC8 v3.x / XC16 v2.x for device-specific headers)
    let dfpFlag = '';
    let dfp = cfg.dfp_path ? cfg.dfp_path : findDFP(mcu);
    if (!dfp && !cfg.dfp_path && !family.startsWith('PIC32')) {
        console.log(`[PICPIO] DFP pack not found for ${mcu}; downloading automatically...`);
        dfp = ensureDFP(mcu);
    }
    if (dfp) {
        dfpFlag = `-mdfp="${dfp}"`;
        if (verbose) console.log(`[PICPIO] DFP: ${dfp}`);
    } else if (!family.startsWith('PIC32')) {
        console.warn('[PICPIO] WARNING: DFP pack not found. Build may fail.');
        console.warn('         Run: picpio install-dfp   (auto-detects the device from picpio.ini)');
        console.warn('         Or set dfp_path in picpio.ini [build] section.');
    }

    let compilerFlags = '';
    if (family.startsWith('PIC32')) {
        compilerFlags = `-mprocessor=${mcu} -O${optLevel} -D_XTAL_FREQ=${clock}`;
    } else if (family.startsWith('PIC24') || family.toUpperCase().startsWith('DSPIC')) {
        compilerFlags = `-mcpu=${mcu} ${dfpFlag} -O${optLevel} -D_XTAL_FREQ=${clock}`;
    } else {
        // XC8 — lowercase MCU name required
        compilerFlags = `-mcpu=${mcu.toLowerCase()} ${dfpFlag} -O${optLevel} -D_XTAL_FREQ=${clock} -std=c99`;
    }

    const srcList = sources.map(s => `"${s}"`).join(' ');
    const command = `"${compiler}" ${compilerFlags} ${incFlags} ${srcList} -o "${outHex}"`;

    console.log(`[PICPIO] Building ${cfg.name || 'firmware'} for ${mcu}...`);
    if (verbose) console.log(`[PICPIO] ${command}`);

    const result = cp.spawnSync(command, [], {
        shell: true,
        stdio: 'inherit',
        cwd:   process.cwd()
    });

    // Remove temp .c copies generated from .cpp files
    for (const tmp of tempFiles) {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }

    if (result.status !== 0) {
        console.error('\n[PICPIO] BUILD FAILED');
        process.exit(result.status || 1);
    }

    console.log(`\n[PICPIO] BUILD SUCCESSFUL`);
    console.log(`[PICPIO] Output: ${outHex}`);

    // Generate compile_commands.json for IntelliSense / clangd / Ctrl+Click
    const compileCommands = sources.map(src => ({
        directory: process.cwd().replace(/\\/g, '/'),
        command:   `"${compiler.replace(/\\/g, '/')}" ${compilerFlags} ${incFlags} "${src.replace(/\\/g, '/')}"`,
        file:      src.replace(/\\/g, '/')
    }));
    fs.writeFileSync(
        path.join(process.cwd(), 'compile_commands.json'),
        JSON.stringify(compileCommands, null, 2)
    );

    if (showSize && fs.existsSync(outHex)) {
        const stat = fs.statSync(outHex);
        console.log(`[PICPIO] HEX size: ${(stat.size / 1024).toFixed(1)} KB`);
    }
}

// ─── DFP HELPERS ─────────────────────────────────────────────────────────────
function getDFPName(mcuFamily) {
    return {
        'PIC18': 'PIC18F-K_DFP',
        'PIC16': 'PIC16Fxxx_DFP',
        'PIC24': 'PIC24F-GA-GB_DFP',
    }[mcuFamily] || null;
}

function getDFPVersion(dfpName) {
    const pdsc = path.join('C:\\picpio\\packs', dfpName, `Microchip.${dfpName}.pdsc`);
    if (!fs.existsSync(pdsc)) return null;
    const m = fs.readFileSync(pdsc, 'utf8').match(/release version="([^"]+)"/);
    return m ? m[1] : null;
}

// ─── DFP INSTALLER FOR MPLAB X ──────────────────────────────────────────────
function ensureDFPinMPLABX(family) {
    family = family || 'PIC18F-K_DFP';

    // Where picpio keeps the DFP
    const srcDir = path.join('C:\\picpio\\packs', family);
    if (!fs.existsSync(srcDir)) {
        console.warn(`[PICPIO] DFP not found at ${srcDir}. Run "picpio install-dfp" first.`);
        return;
    }

    // Read version from pdsc
    let version = '1.0.0';
    const pdsc = path.join(srcDir, `Microchip.${family}.pdsc`);
    if (fs.existsSync(pdsc)) {
        const m = fs.readFileSync(pdsc, 'utf8').match(/release version="([^"]+)"/);
        if (m) version = m[1];
    }

    // Find MPLAB X install
    const mplabBase = 'C:\\Program Files\\Microchip\\MPLABX';
    if (!fs.existsSync(mplabBase)) return;
    const vers = fs.readdirSync(mplabBase).filter(d => d.startsWith('v')).sort((a,b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    if (!vers[0]) return;

    const destDir = path.join(mplabBase, vers[0], 'packs', 'Microchip', family, version);
    if (fs.existsSync(destDir)) return; // already installed

    console.log(`[PICPIO] Installing DFP ${family} v${version} into MPLAB X...`);
    try {
        copyDirRecursive(srcDir, destDir);
        console.log(`[PICPIO] DFP installed at ${destDir}`);
    } catch (e) {
        if (e.code === 'EPERM' || e.code === 'EACCES') {
            // Program Files requires admin — write script to C:\picpio (no spaces) and run elevated
            console.log('[PICPIO] Admin required — requesting elevation (UAC prompt will appear)...');
            const scriptPath = 'C:\\picpio\\dfp_install.ps1';
            fs.writeFileSync(scriptPath, [
                `New-Item -ItemType Directory -Force '${destDir}' | Out-Null`,
                `Copy-Item -Path '${srcDir}\\*' -Destination '${destDir}' -Recurse -Force`,
            ].join('\r\n'));
            cp.spawnSync('powershell', [
                '-NoProfile', '-Command',
                `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File C:\\picpio\\dfp_install.ps1'`
            ], { stdio: 'inherit' });
            try { fs.unlinkSync(scriptPath); } catch (_) {}
            if (fs.existsSync(destDir)) {
                console.log('[PICPIO] DFP installed successfully.');
            } else {
                console.warn('[PICPIO] DFP install failed or was cancelled.');
                console.warn(`[PICPIO] Manual fix: open MPLAB X → Tools → Packs → install ${family}`);
            }
        } else {
            console.warn(`[PICPIO] Could not install DFP: ${e.message}`);
            console.warn(`[PICPIO] Manual fix: open MPLAB X → Tools → Packs → install ${family}`);
        }
    }
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src,  entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ─── UPLOAD ──────────────────────────────────────────────────────────────────
function cmdUpload(opts) {
    const cfg      = requireConfig();
    const mcu      = cfg.mcu || 'PIC18F27K40';
    const prog     = cfg.programmer || 'PICKit4';
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');
    const hexFile  = path.join(buildDir, (cfg.name || 'firmware') + '.hex');

    if (!fs.existsSync(hexFile)) {
        console.log('[PICPIO] No hex file found. Building first...');
        cmdBuild([]);
    }

    const ipecmd = findIPE();
    if (!ipecmd) {
        console.error('[PICPIO] MPLAB IPE not found.');
        console.error('         Install MPLAB X from https://www.microchip.com/mplabx');
        process.exit(1);
    }

    // Map MCU family → DFP pack name
    const dfpName = getDFPName(cfg.family);
    let owdFlag = '';
    if (dfpName) {
        ensureDFPinMPLABX(dfpName);
        const dfpVer = getDFPVersion(dfpName);
        if (dfpVer) owdFlag = `-OWD${dfpName},${dfpVer},Microchip`;
    }

    const progFlag = {
        'PICKit4': '-TPPK4',
        'PICKit5': '-TPPK5',
        'PICKit3': '-TPPK3',
        'ICD4':    '-TPICD4',
        'ICD5':    '-TPICD5',
        'Snap':    '-TPSNAP',
    }[prog] || '-TPPK4';

    const command = `"${ipecmd}" -P${mcu} ${progFlag} -F"${hexFile}" -M ${owdFlag} -OL`;
    console.log(`[PICPIO] Uploading to ${mcu} via ${prog}...`);

    const result = cp.spawnSync(command, [], { shell: true, stdio: 'inherit' });
    if (result.status !== 0) {
        console.error('[PICPIO] UPLOAD FAILED');
        process.exit(result.status || 1);
    }
    console.log('[PICPIO] UPLOAD SUCCESSFUL');
}

// ─── CLEAN ───────────────────────────────────────────────────────────────────
function cmdClean() {
    const cfg      = requireConfig();
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`[PICPIO] Cleaned: ${buildDir}`);
    } else {
        console.log('[PICPIO] Nothing to clean.');
    }
}

// ─── MONITOR ─────────────────────────────────────────────────────────────────
function cmdMonitor() {
    const cfg  = requireConfig();
    const port = cfg.monitor_port || 'COM3';
    const baud = cfg.monitor_baud || '9600';

    // Check port actually exists before trying to open it
    try {
        const available = cp.execSync(
            'powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object"',
            { timeout: 5000 }
        ).toString().trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);

        if (available.length === 0) {
            console.error('[PICPIO] No serial ports detected. Connect your device and try again.');
            process.exit(1);
        }
        if (!available.includes(port)) {
            console.error(`[PICPIO] Port '${port}' not found. Available ports: ${available.join(', ')}`);
            console.error(`         Update monitor_port in picpio.ini to one of the above.`);
            process.exit(1);
        }
    } catch (e) {
        // If we can't check, try anyway
    }

    console.log(`[PICPIO] Serial Monitor on ${port} @ ${baud} baud — Ctrl+C to exit`);
    try {
        cp.execSync(
            `powershell -NoProfile -Command "$p=new-object System.IO.Ports.SerialPort '${port}',${baud},'None',8,'One'; $p.Open(); try { while($true){ $l=$p.ReadLine(); Write-Host $l } } finally { $p.Close() }"`,
            { stdio: 'inherit' }
        );
    } catch {}
}

// ─── ERASE ───────────────────────────────────────────────────────────────────
function cmdErase() {
    const cfg     = requireConfig();
    const mcu     = cfg.mcu || 'PIC18F27K40';
    const prog    = cfg.programmer || 'PICKit4';
    const ipecmd  = findIPE();
    if (!ipecmd) { console.error('[PICPIO] MPLAB IPE not found.'); process.exit(1); }
    const dfpName = getDFPName(cfg.family);
    let owdFlag = '';
    if (dfpName) {
        ensureDFPinMPLABX(dfpName);
        const dfpVer = getDFPVersion(dfpName);
        if (dfpVer) owdFlag = `-OWD${dfpName},${dfpVer},Microchip`;
    }
    const progFlag = { 'PICKit4':'-TPPK4','PICKit5':'-TPPK5','PICKit3':'-TPPK3' }[prog] || '-TPPK4';
    cp.spawnSync(`"${ipecmd}" -P${mcu} ${progFlag} -E ${owdFlag} -OL`, [], { shell: true, stdio: 'inherit' });
}

// ─── LIB ─────────────────────────────────────────────────────────────────────
const BUNDLED_LIBS = [
    'dht22','ds18b20','ssd1306','liquidcrystal','servo','encoder',
    'wire','spi','hardwareserial','at24c256','keypad','pid','mpu6050','bmp280'
];

function cmdLib(args) {
    const sub = args[0];
    if (!sub) { console.log('Usage: picpio lib <add|remove|list|update>'); return; }

    if (sub === 'list') {
        const libDir = path.join(process.cwd(), 'lib');
        if (!fs.existsSync(libDir)) { console.log('[PICPIO] No libraries installed.'); return; }
        const libs = fs.readdirSync(libDir).filter(d => fs.statSync(path.join(libDir, d)).isDirectory());
        if (!libs.length) { console.log('[PICPIO] No libraries installed.'); return; }
        console.log('[PICPIO] Installed libraries:');
        libs.forEach(l => console.log(`  - ${l}`));
        return;
    }

    if (sub === 'update') {
        console.log('[PICPIO] Registry is bundled — no update needed for bundled libraries.');
        return;
    }

    if (sub === 'add') {
        const name = args[1];
        if (!name) { console.error('[PICPIO] Usage: picpio lib add <name>'); process.exit(1); }
        libAdd(name);
        return;
    }

    if (sub === 'remove') {
        const name = args[1];
        if (!name) { console.error('[PICPIO] Usage: picpio lib remove <name>'); process.exit(1); }
        libRemove(name);
        return;
    }

    if (sub === 'search') {
        const q = (args[1] || '').toLowerCase();
        console.log('[PICPIO] Available libraries:');
        BUNDLED_LIBS
            .filter(l => !q || l.includes(q))
            .forEach(l => console.log(`  ${l}`));
        return;
    }

    console.error(`[PICPIO] Unknown lib subcommand: ${sub}`);
}

function libAdd(name) {
    const libDir = path.join(process.cwd(), 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    // GitHub shorthand
    if (name.startsWith('github:')) {
        const repo = name.slice(7);
        const url  = `https://github.com/${repo}/archive/refs/heads/main.zip`;
        console.log(`[PICPIO] Downloading from GitHub: ${repo}`);
        downloadAndExtract(url, libDir, repo.split('/').pop());
        return;
    }

    // Direct URL
    if (name.startsWith('http://') || name.startsWith('https://')) {
        const fname = path.basename(name);
        console.log(`[PICPIO] Downloading: ${name}`);
        downloadFile(name, path.join(libDir, fname));
        return;
    }

    // Bundled library — copy from arduino_compat/
    const lname    = name.toLowerCase();
    const acDir    = path.join(process.cwd(), 'arduino_compat');
    const scriptDir = path.dirname(process.argv[1]);

    // Try arduino_compat in project, then next to picpio.js
    const searchPaths = [
        acDir,
        path.join(scriptDir, 'arduino_compat'),
        path.join(scriptDir, '..', 'arduino_compat'),
    ];

    let found = false;
    for (const base of searchPaths) {
        if (!fs.existsSync(base)) continue;
        // Look for matching .h/.cpp files
        const files = fs.readdirSync(base).filter(f =>
            f.toLowerCase().replace(/\.(h|cpp|c)$/, '') === lname ||
            f.toLowerCase().startsWith(lname + '.')
        );
        if (files.length) {
            const dest = path.join(libDir, name);
            fs.mkdirSync(dest, { recursive: true });
            files.forEach(f => fs.copyFileSync(path.join(base, f), path.join(dest, f)));
            console.log(`[PICPIO] Installed library '${name}' (${files.length} files)`);
            updateIniLibs(name);
            found = true;
            break;
        }
    }

    if (!found) {
        console.error(`[PICPIO] Library '${name}' not found in bundled registry.`);
        console.log(`         Try: picpio lib add github:user/${name}`);
        console.log(`         Or:  picpio lib add https://url/to/library.h`);
    }
}

function libRemove(name) {
    const libDir = path.join(process.cwd(), 'lib', name);
    if (fs.existsSync(libDir)) {
        fs.rmSync(libDir, { recursive: true, force: true });
        console.log(`[PICPIO] Removed library '${name}'`);
    } else {
        console.error(`[PICPIO] Library '${name}' is not installed.`);
    }
}

function updateIniLibs(name) {
    const iniPath = path.join(process.cwd(), 'picpio.ini');
    if (!fs.existsSync(iniPath)) return;
    let text = fs.readFileSync(iniPath, 'utf8');
    const m  = text.match(/^installed\s*=\s*(.*)$/m);
    if (m) {
        const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
        if (!existing.includes(name)) {
            existing.push(name);
            text = text.replace(/^installed\s*=.*$/m, `installed  = ${existing.join(', ')}`);
            fs.writeFileSync(iniPath, text);
        }
    }
}

function downloadFile(url, dest) {
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${dest}'"`,
        [], { shell: true, stdio: 'inherit' }
    );
    if (result.status !== 0) console.error('[PICPIO] Download failed.');
}

function downloadAndExtract(url, libDir, name) {
    const tmp = path.join(os.tmpdir(), `picpio_${Date.now()}.zip`);
    downloadFile(url, tmp);
    if (!fs.existsSync(tmp)) return;
    const dest = path.join(libDir, name);
    fs.mkdirSync(dest, { recursive: true });
    cp.spawnSync(
        `powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${dest}' -Force"`,
        [], { shell: true, stdio: 'inherit' }
    );
    fs.rmSync(tmp, { force: true });
    console.log(`[PICPIO] Installed '${name}'`);
    updateIniLibs(name);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function cmdInit(args) {
    const params = parseFlags(args);
    const name   = params['name'] || path.basename(process.cwd());
    const mcu    = params['mcu']  || 'PIC18F27K40';
    const family = params['family'] || 'PIC18';
    const clock  = params['clock'] || '64000000';
    const prog   = params['programmer'] || 'PICKit4';
    const fw     = params['framework'] || 'bare-metal';
    const outDir = params['output'] || path.join(process.cwd(), name);

    fs.mkdirSync(path.join(outDir, 'src'),     { recursive: true });
    fs.mkdirSync(path.join(outDir, 'lib'),     { recursive: true });
    fs.mkdirSync(path.join(outDir, '.vscode'), { recursive: true });

    fs.writeFileSync(path.join(outDir, 'picpio.ini'), [
        '[project]',
        `name       = ${name}`,
        `mcu        = ${mcu}`,
        `family     = ${family}`,
        `clock_hz   = ${clock}`,
        `framework  = ${fw}`,
        '',
        '[build]',
        `src_dir    = src`,
        `build_dir  = .picpio`,
        `opt_level  = 2`,
        '',
        '[upload]',
        `programmer = ${prog}`,
        '',
        '[libraries]',
        `installed  =`,
    ].join('\n'));

    const mainFile = fw === 'arduino'
        ? path.join(outDir, 'src', 'main.cpp')
        : path.join(outDir, 'src', 'main.c');

    const mainContent = fw === 'arduino' ? [
        '#include <Arduino.h>',
        '',
        'void setup() {',
        '    Serial.begin(115200);',
        '    pinMode(13, OUTPUT);',
        '}',
        '',
        'void loop() {',
        '    digitalWrite(13, HIGH);',
        '    delay(500);',
        '    digitalWrite(13, LOW);',
        '    delay(500);',
        '}',
    ].join('\n') : [
        `// ${name} - PIC ${mcu}`,
        '#include <xc.h>',
        `#pragma config FEXTOSC=OFF, RSTOSC=HFINTOSC_64MHZ`,
        `#pragma config WDTE=OFF, LVP=OFF`,
        '',
        'void main(void) {',
        '    TRISCbits.TRISC0 = 0;',
        '    while (1) {',
        '        LATCbits.LATC0 ^= 1;',
        '        __delay_ms(500);',
        '    }',
        '}',
    ].join('\n');

    fs.writeFileSync(mainFile, mainContent);

    // .vscode/tasks.json
    fs.writeFileSync(path.join(outDir, '.vscode', 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            { label:'PICPIO: Build',  type:'shell', command:'picpio build',  group:{ kind:'build', isDefault:true }, problemMatcher:['$xc8','$xc8-2'] },
            { label:'PICPIO: Upload', type:'shell', command:'picpio upload', group:'test', problemMatcher:[] },
            { label:'PICPIO: Clean',  type:'shell', command:'picpio clean',  group:'none', problemMatcher:[] },
        ]
    }, null, 2));

    console.log(`[PICPIO] Project '${name}' created at ${outDir}`);
    console.log(`[PICPIO] MCU: ${mcu} | Family: ${family} | Framework: ${fw}`);
}

// ─── VSCODE CONFIG ───────────────────────────────────────────────────────────
function cmdVscode() {
    const cfg  = requireConfig();
    const mcu  = cfg.mcu || 'PIC18F27K40';

    // Find XC8 include dirs (v3.x has separate include and include/c99)
    const base = 'C:\\Program Files\\Microchip\\xc8';
    let xc8Inc  = 'C:/Program Files/Microchip/xc8/v3.10/pic/include';
    let xc8Inc2 = 'C:/Program Files/Microchip/xc8/v3.10/pic/include/c99';
    if (fs.existsSync(base)) {
        const vers = fs.readdirSync(base).filter(d => d.startsWith('v')).sort().reverse();
        if (vers[0]) {
            xc8Inc  = `C:/Program Files/Microchip/xc8/${vers[0]}/pic/include`;
            xc8Inc2 = `C:/Program Files/Microchip/xc8/${vers[0]}/pic/include/c99`;
        }
    }

    const vsDir = path.join(process.cwd(), '.vscode');
    fs.mkdirSync(vsDir, { recursive: true });

    fs.writeFileSync(path.join(vsDir, 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            { label:'PICPIO: Build',  type:'shell', command:'picpio build',  group:{ kind:'build', isDefault:true }, problemMatcher:['$xc8','$xc8-2'] },
            { label:'PICPIO: Upload', type:'shell', command:'picpio upload', group:'test', problemMatcher:[] },
            { label:'PICPIO: Clean',  type:'shell', command:'picpio clean',  group:'none', problemMatcher:[] },
        ]
    }, null, 2));

    const extraInclude = (cfg.lib_extra_dirs || '').split(',').map(s => s.trim()).filter(Boolean);

    fs.writeFileSync(path.join(vsDir, 'c_cpp_properties.json'), JSON.stringify({
        configurations: [{
            name: mcu,
            includePath: [
                '${workspaceFolder}/src',
                '${workspaceFolder}/include',
                '${workspaceFolder}/lib/**',
                xc8Inc,
                xc8Inc2,
                xc8Inc.replace('/include', '/include/proc'),
                'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include',
                'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include/proc',
                'C:/picpio/arduino_compat',
                ...extraInclude
            ],
            defines: [`__${mcu}__`, `_XTAL_FREQ=${cfg.clock_hz || '64000000'}`],
            cStandard: 'c99',
            intelliSenseMode: 'gcc-x86'
        }],
        version: 4
    }, null, 2));

    console.log('[PICPIO] Generated .vscode/tasks.json');
    console.log('[PICPIO] Generated .vscode/c_cpp_properties.json');
}

// ─── INSTALL DFP ─────────────────────────────────────────────────────────────
// Works for ANY Microchip device or DFP pack name by resolving against the
// official pack index (see resolvePack). Examples:
//   picpio install-dfp                 (uses [project] mcu from picpio.ini)
//   picpio install-dfp PIC16F877A      (resolve by device part number)
//   picpio install-dfp PIC16Fxxx_DFP   (resolve by exact pack name)
function cmdInstallDFP(arg) {
    let mcu = null;
    let target = arg;

    if (!target) {
        const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
        if (!cfg || !cfg.mcu) {
            console.error('[PICPIO] No device specified and no picpio.ini with [project] mcu found.');
            console.error('         Usage: picpio install-dfp <device or DFP name>  (e.g. PIC16F877A)');
            process.exit(1);
        }
        mcu = cfg.mcu;
        target = cfg.mcu;
    } else if (!/_DFP$/i.test(target)) {
        mcu = target;
    }

    console.log(`[PICPIO] Resolving DFP for ${target}...`);
    const pack = resolvePack(target);
    if (!pack) {
        console.error(`[PICPIO] Could not find a Device Family Pack for "${target}" in the Microchip pack index.`);
        console.error('         Check the device/pack name, or install MPLAB X and use Tools > Packs.');
        process.exit(1);
    }

    const destDir = path.join(PACKS_DIR, pack.name);
    if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) {
        console.log(`[PICPIO] DFP already installed: ${destDir} (${pack.name} v${pack.version})`);
    } else {
        const dir = downloadPack(pack.name, pack.version);
        if (!dir) {
            console.error(`[PICPIO] Could not download ${pack.name} v${pack.version}.`);
            console.error('         Install MPLAB X and use Tools > Packs to install the DFP,');
            console.error('         then set dfp_path in picpio.ini [build] section:');
            console.error(`         dfp_path = C:\\path\\to\\${pack.name}\\${pack.version}`);
            process.exit(1);
        }
        console.log(`[PICPIO] DFP installed: ${dir} (${pack.name} v${pack.version})`);
    }

    if (mcu) {
        const manifest = loadDFPManifest();
        manifest[mcu.toUpperCase()] = pack.name;
        saveDFPManifest(manifest);
    }
    console.log('[PICPIO] Run "picpio build" again.');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function parseFlags(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            out[key]  = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
        }
    }
    return out;
}
