#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * libporter.js - Automated Arduino C++ to PICPIO C Porting Tool
 * 
 * Usage: node libporter.js <PathToArduinoLibHeader.h>
 */

const headerPath = process.argv[2];
if (!headerPath || !fs.existsSync(headerPath)) {
    console.error("Usage: node libporter.js <LibraryHeader.h>");
    process.exit(1);
}

const content = fs.readFileSync(headerPath, 'utf8');
const libName = path.basename(headerPath, '.h').replace(/^Adafruit_/, '');
const className = content.match(/class\s+([A-Za-z0-9_]+)/)?.[1] || libName;
const cPrefix = className.replace(/^Adafruit_/, '');

console.log(`/*
 * PICPIO C-Port for ${className}
 * Automatically generated from ${path.basename(headerPath)}
 */

#ifndef ${cPrefix.toUpperCase()}_H
#define ${cPrefix.toUpperCase()}_H

#include "Picpio.h"

typedef struct {
    uint8_t _address;
    TwoWire_t *_wire;
    // Add private state variables here from the original class members
} ${cPrefix}_t;
`);

// Extract public methods
const methodRegex = /^\s*(?:virtual\s+)?([A-Za-z0-9_*&]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm;
let match;
const methods = [];

while ((match = methodRegex.exec(content)) !== null) {
    let [full, retType, methodName, params] = match;
    
    // Skip constructors/destructors
    if (methodName === className || methodName === `~${className}`) continue;

    // Clean up parameters and map types
    let cParams = params.split(',').map(p => {
        p = p.trim();
        p = p.replace(/TwoWire\s*\*?\s*(\w+)?/, 'TwoWire_t *$1');
        p = p.replace(/Adafruit_Sensor\s*\*?/, 'void*'); // Generic sensor pointer
        return p;
    }).filter(p => p.length > 0);

    // Prepend the instance pointer
    cParams.unshift(`${cPrefix}_t *device`);

    const cFunctionName = `${cPrefix}_${methodName}`;
    methods.push({ retType, cFunctionName, cParams: cParams.join(', ') });
    
    console.log(`${retType} ${cFunctionName}(${cParams.join(', ')});`);
}

console.log(`\n#endif // ${cPrefix.toUpperCase()}_H`);

// Generate a template .c file to console as well
console.log(`\n/* --- Implementation Template (${cPrefix}.c) --- */\n`);
console.log(`#include "${cPrefix}.h"\n`);

methods.forEach(m => {
    console.log(`${m.retType} ${m.cFunctionName}(${m.cParams}) {`);
    if (m.cFunctionName.endsWith('_begin')) {
        console.log(`    device->_wire = &Wire; // Default to standard Wire`);
        console.log(`    // TODO: Implement initialization logic`);
    }
    if (m.retType !== 'void') {
        console.log(`    return (${m.retType})0; // TODO: Implement`);
    }
    console.log(`}\n`);
});

/**
 * How to use:
 * 1. Run: node libporter.js path/to/Adafruit_BME280.h > BME280.h
 * 2. Copy the "Implementation Template" section into BME280.c
 * 3. Replace the Arduino internal calls (e.g., _wire->write) with PICPIO HAL calls (e.g., device->_wire->write).
 */