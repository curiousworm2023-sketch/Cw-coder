#!/usr/bin/env node
// EDC-driven pin-map generator for PICPIO HALs.
//
//   node genpinmap.js <MCU> [--style=16|8]
//   e.g. node genpinmap.js dsPIC30F4011
//
// Reads Microchip's EDC "<part>.PIC" device file (shipped in the installed
// MPLAB X DFP packs) and emits ready-to-paste:
//   * a capability summary (ports, ADC channels, UART/SPI/I2C/OC pin map),
//   * the Picpio.h pin defines (Dn / An / native R-names / LED_BUILTIN),
//   * the wiring.c _pins[] table.
// This automates the tedious, error-prone part of adding a new MCU to a HAL;
// per-chip config-word / peripheral-register quirks and a build-test are still
// done by hand.
//
// --style=16 (default): 16-bit PinInfo rows (volatile unsigned int* SFRs,
//   dsPIC/PIC24 HALs). --style=8: 8-bit rows (uint8_t* SFRs, PIC16/PIC18).

const fs   = require('fs');
const path = require('path');

const mcu = process.argv[2];
const styleArg = (process.argv.find(a => a.startsWith('--style=')) || '--style=16').split('=')[1];
const style8 = styleArg === '8';
if (!mcu) { console.error('Usage: node genpinmap.js <MCU> [--style=16|8]'); process.exit(1); }

// ── 1. Locate the EDC .PIC file under the MPLAB X packs ───────────────────────
function findEdc(name) {
    const target = name.toUpperCase() + '.PIC';
    const roots = [
        'C:/Program Files/Microchip/MPLABX',
        'C:/Program Files (x86)/Microchip/MPLABX',
    ];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const ver of safeReaddir(root)) {
            const packs = path.join(root, ver, 'packs');
            if (!fs.existsSync(packs)) continue;
            const hit = walk(packs, target, 6);
            if (hit) return hit;
        }
    }
    return null;
}
function safeReaddir(d) { try { return fs.readdirSync(d); } catch { return []; } }
function walk(dir, target, depth) {
    if (depth < 0) return null;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { const r = walk(full, target, depth - 1); if (r) return r; }
        else if (e.name.toUpperCase() === target) return full;
    }
    return null;
}

const edcPath = findEdc(mcu);
if (!edcPath) { console.error(`[genpinmap] EDC file ${mcu}.PIC not found under MPLAB X packs.`); process.exit(1); }

// ── 2. Parse the PinList into physical pins -> function names ─────────────────
const xml = fs.readFileSync(edcPath, 'utf8');
const listMatch = xml.match(/<edc:PinList[\s\S]*?<\/edc:PinList>/);
if (!listMatch) { console.error('[genpinmap] no <edc:PinList> in EDC file.'); process.exit(1); }
const pinBlocks = listMatch[0].match(/<edc:Pin>[\s\S]*?<\/edc:Pin>/g) || [];

const RNAME = /^R([A-K])(\d{1,2})$/;   // GPIO virtual-pin name, e.g. RB8
const ioPins = [];
for (const block of pinBlocks) {
    const names = [...block.matchAll(/<edc:VirtualPin\s+edc:name="([^"]+)"/g)].map(m => m[1]);
    const rname = names.find(n => RNAME.test(n));
    if (!rname) continue;                       // power/osc/MCLR pins: skip
    const [, port, bitStr] = rname.match(RNAME);
    const anName = names.find(n => /^AN\d+$/.test(n));
    ioPins.push({
        port,
        bit:  parseInt(bitStr, 10),
        rname,
        adc:  anName ? parseInt(anName.slice(2), 10) : null,
        funcs: names.filter(n => n !== rname),
    });
}
if (!ioPins.length) { console.error('[genpinmap] no GPIO pins parsed.'); process.exit(1); }

// ── 3. Peripheral function -> pin map (first pin that carries each) ───────────
// Covers 16-bit naming (U1RX/SCK1/OCn) and 8-bit naming (RX/TX/CCPn/SDO).
const PERIPH = /^(U[12]?RX|U[12]?TX|RX[12]?|TX[12]?|CK[12]?|DT[12]?|SCK[12]?|SDI[12]?|SDO[12]?|SS[12]?|SCL[12]?|SDA[12]?|OC\d+|CCP\d+|P\d[A-D])$/;
const periph = {};
for (const p of ioPins) for (const f of p.funcs) {
    if (PERIPH.test(f) && !(f in periph)) periph[f] = p.rname;
}

// ── 4. Order pins: PORTB first (keeps A0..ANk aligned), then A,C,D,E,F,G,H,J,K ─
const order = ['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];
ioPins.sort((a, b) => {
    const d = order.indexOf(a.port) - order.indexOf(b.port);
    return d !== 0 ? d : a.bit - b.bit;
});
ioPins.forEach((p, i) => { p.dn = i; });

// Ports present (bit ranges)
const portBits = {};
for (const p of ioPins) (portBits[p.port] ||= []).push(p.bit);

// ── 5. Emit ──────────────────────────────────────────────────────────────────
const out = [];
const adcPins = ioPins.filter(p => p.adc !== null).sort((a, b) => a.adc - b.adc);
const pwmKeys = Object.keys(periph).filter(k => /^(OC\d+|CCP\d+|P\d[A-D])$/.test(k))
    .sort((a, b) => (a.match(/\d+/) - b.match(/\d+/)) || a.localeCompare(b));
const led = periph['OC1'] ? ioPins.find(p => p.rname === periph['OC1']) : ioPins[0];

// Show "key=pin" for whichever of the candidate names this chip actually uses
// (16-bit parts say U1RX/SCK1, 8-bit parts say RX/SCK -- list both forms).
const periphLine = (keys) => keys.filter(k => periph[k]).map(k => `${k}=${periph[k]}`).join(' ');

out.push(`// ===== ${mcu}  (${ioPins.length} I/O pins) =====`);
out.push(`// EDC: ${edcPath}`);
out.push(`// Ports: ${order.filter(p => portBits[p]).map(p => `${p}(${rangeStr(portBits[p])})`).join('  ')}`);
out.push(`// ADC: ${adcPins.length ? `AN${adcPins[0].adc}-AN${adcPins[adcPins.length-1].adc} (${adcPins.length} ch)` : 'none'}`);
out.push(`// UART1: ${periphLine(['U1RX','RX','RX1','U1TX','TX','TX1']) || '-'}    UART2: ${periphLine(['U2RX','RX2','U2TX','TX2']) || '-'}`);
out.push(`// SPI1:  ${periphLine(['SCK1','SCK','SDI1','SDI','SDO1','SDO','SS1','SS']) || '-'}`);
out.push(`// I2C:   ${periphLine(['SCL','SDA','SCL1','SDA1','SCL2','SDA2']) || '-'}`);
out.push(`// PWM:   ${periphLine(pwmKeys) || '-'}`);
out.push('');

// Picpio.h block
out.push('// ---- Picpio.h ----');
ioPins.forEach(p => {
    const hint = notableFuncs(p);
    out.push(`#define D${p.dn}${pad(p.dn)} ${p.dn}${hint ? '   // ' + p.rname + ' ' + hint : ''}`);
});
adcPins.forEach(p => out.push(`#define A${p.adc}${pad(p.adc)} D${p.dn}`));
out.push(`#define LED_BUILTIN  D${led.dn}`);
out.push('');
ioPins.forEach(p => out.push(`#define ${p.rname}${' '.repeat(Math.max(1, 5 - p.rname.length))} D${p.dn}`));
out.push('');

// wiring.c _pins[] block
out.push('// ---- wiring.c ----');
out.push('static const PinInfo _pins[] = {');
ioPins.forEach(p => {
    const adc = p.adc !== null ? p.adc : 'NO_ADC';
    const nf = notableFuncs(p);
    const comment = `// D${p.dn}  ${p.rname}${p.adc !== null ? '/AN' + p.adc : ''}${nf ? ' -- ' + nf : ''}`;
    out.push(`    { &TRIS${p.port}, &LAT${p.port}, &PORT${p.port}, ${p.bit}, ${adc} }, ${comment}`);
});
out.push('};');
out.push(`#define PIN_COUNT ${ioPins.length}`);
if (style8) out.push('// NOTE: --style=8 requested -- adapt PinInfo field types (uint8_t* SFRs) and');
if (style8) out.push('//       the ADC path to the 8-bit HAL by hand; pin/bit/adc data above is correct.');

console.log(out.join('\n'));

// ── helpers ──
function rangeStr(bits) {
    const s = [...new Set(bits)].sort((a, b) => a - b);
    const parts = []; let start = s[0], prev = s[0];
    for (let i = 1; i <= s.length; i++) {
        if (s[i] === prev + 1) { prev = s[i]; continue; }
        parts.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = prev = s[i];
    }
    return parts.join(',');
}
function pad(n) { return ' '.repeat(Math.max(0, 3 - String(n).length)); }
function notableFuncs(p) {
    return p.funcs.filter(f => PERIPH.test(f)).join('/');
}
