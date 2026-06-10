// Best-effort transpiler: converts a common subset of Arduino-flavoured C/C++
// (as used in PICPIO's arduino_compat sketches) into plain JavaScript that can
// run inside a Node vm sandbox for live simulation.
//
// It does NOT attempt to be a full C parser. It handles the patterns that
// PICPIO's templates and peripheral-insert snippets generate: setup()/loop(),
// simple typed declarations, arrays, for-loop counters and #define constants.
// Anything it can't translate is left as-is and will surface as a runtime
// error in the simulator (reported back to the user), rather than crashing
// the extension.

const TYPES =
    '(?:unsigned\\s+|signed\\s+|static\\s+|volatile\\s+|const\\s+)*' +
    '(?:void|int|long|short|char|float|double|bool|byte|String|' +
    'uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t)';

export interface TranspileResult {
    code: string;
    warnings: string[];
}

export function transpileSketch(src: string): TranspileResult {
    const warnings: string[] = [];
    let s = src;

    // Strip comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.replace(/\/\/[^\n]*/g, '');

    // Preprocessor directives, line by line
    const outLines: string[] = [];
    for (const raw of s.split('\n')) {
        const t = raw.trim();
        if (t.startsWith('#')) {
            let m = t.match(/^#define\s+(\w+)\(([^)]*)\)\s+(.+)$/);
            if (m) { outLines.push(`function ${m[1]}(${m[2]}) { return (${m[3]}); }`); continue; }
            m = t.match(/^#define\s+(\w+)\s+(.+)$/);
            if (m) { outLines.push(`const ${m[1]} = (${m[2]});`); continue; }
            if (/^#(ifdef|ifndef|if)\b/.test(t)) warnings.push(`Skipped conditional: ${t}`);
            continue; // drop #include, #pragma, #ifdef/#endif/#else, #undef, etc.
        }
        outLines.push(raw);
    }
    s = outLines.join('\n');

    // Function signatures: "<type> name(params) {" -> "function name(params) {"
    s = s.replace(new RegExp(`\\b${TYPES}\\s*\\*?\\s*(\\w+)\\s*\\(([^;{]*)\\)\\s*\\{`, 'g'),
        (_full: string, name: string, params: string) => {
            const trimmed = params.trim();
            if (trimmed === '' || trimmed === 'void') return `function ${name}() {`;
            const cleaned = trimmed.split(',').map(p => {
                const pm = p.trim().match(new RegExp(`^${TYPES}\\s*\\*?\\s*&?\\s*(\\w+)(\\s*\\[\\s*\\])?$`));
                return pm ? pm[1] : p.trim().replace(/[*&]/g, '');
            }).join(', ');
            return `function ${name}(${cleaned}) {`;
        });

    // Array declarations: "type name[N] = {...};" or "type name[N];"
    s = s.replace(new RegExp(`\\b${TYPES}\\s*\\*?\\s*(\\w+)\\s*\\[\\s*(\\d*)\\s*\\]\\s*(=\\s*\\{([^}]*)\\})?\\s*;`, 'g'),
        (_full: string, name: string, size: string, hasInit: string | undefined, items: string) => {
            if (hasInit !== undefined) return `let ${name} = [${items}];`;
            const n = size ? parseInt(size, 10) : 0;
            return `let ${name} = new Array(${n}).fill(0);`;
        });

    // for-loop init declarations: "for (type i = 0; ..." -> "for (let i = 0; ..."
    s = s.replace(new RegExp(`\\bfor\\s*\\(\\s*${TYPES}\\s+(\\w+)`, 'g'), 'for (let $1');

    // C-style casts: "(uint8_t)x" / "(unsigned long)(a + b)" -> "x" / "(a + b)".
    // Left in place these read as an invalid call expression in JS
    // ("missing ) after argument list").
    const CAST_TYPE =
        '(?:unsigned\\s+|signed\\s+|const\\s+|volatile\\s+)*' +
        '(?:void|int|long|short|char|float|double|bool|byte|String|' +
        'uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t)';
    s = s.replace(new RegExp(`\\(\\s*${CAST_TYPE}\\s*\\*?\\s*\\)(?=\\s*[\\w(])`, 'g'), '');

    // Char-literal arithmetic, e.g. (char)('0' + (value % 10)) -- the common
    // digit-to-ASCII idiom. Convert 'X' to its numeric char code, but only
    // when adjacent to + or -, so JS does numeric math instead of string
    // concatenation. Other char literals (e.g. Serial.println('A')) are
    // left untouched.
    const charCode = (raw: string): number => {
        if (raw.length === 1) return raw.charCodeAt(0);
        switch (raw) {
            case '\\n': return 10;
            case '\\t': return 9;
            case '\\r': return 13;
            case '\\0': return 0;
            case '\\\\': return 92;
            case "\\'": return 39;
            case '\\"': return 34;
            default: return raw.charCodeAt(raw.length - 1);
        }
    };
    s = s.replace(/'(\\.|[^'\\])'(\s*[+-])/g, (_full: string, ch: string, op: string) => `${charCode(ch)}${op}`);
    s = s.replace(/([+-]\s*)'(\\.|[^'\\])'/g, (_full: string, op: string, ch: string) => `${op}${charCode(ch)}`);

    // Hoist `static <type> name = init;` locals to module scope (declared
    // once, before setup()/loop() are first called) so their value persists
    // across the repeated, independent vm.runInContext() calls used to run
    // loop() — a plain `let` re-declared inside the function would reset to
    // its initial value on every iteration.
    const SCALAR_TYPE =
        '(?:unsigned\\s+|signed\\s+|volatile\\s+|const\\s+)*' +
        '(?:void|int|long|short|char|float|double|bool|byte|String|' +
        'uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t)';
    const hoisted: string[] = [];
    const seenStatics = new Set<string>();
    s = s.replace(new RegExp(`^[ \\t]*static\\s+${SCALAR_TYPE}\\s*\\*?\\s*(\\w+)\\s*(=\\s*[^;]+)?;[ \\t]*$`, 'gm'),
        (_full: string, name: string, init?: string) => {
            if (!seenStatics.has(name)) {
                seenStatics.add(name);
                hoisted.push(`let ${name}${init ?? ' = 0'};`);
            }
            return '';
        });

    // Generic variable declarations (incl. comma-separated declarators)
    s = s.replace(new RegExp(`^(\\s*)${TYPES}\\s*\\*?\\s*(\\w+\\s*(?:=\\s*[^,;]+)?(?:\\s*,\\s*\\*?\\w+(?:\\s*=\\s*[^,;]+)?)*)\\s*;`, 'gm'),
        (_full: string, indent: string, decls: string) => `${indent}let ${decls.replace(/\*/g, '')};`);

    if (hoisted.length) s = hoisted.join('\n') + '\n' + s;

    return { code: s, warnings };
}
