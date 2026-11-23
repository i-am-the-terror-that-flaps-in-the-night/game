// Builds khanacademy.html: the whole game as ONE self-contained HTML file
// (no external requests) for pasting into a Khan Academy webpage project.
//
//   npm run build:khan
//
// - js/main.js and its import graph -> one classic IIFE <script> (esbuild via
//   npx, so it's not a devDependency).
// - css/*.css (in index.html <link> order) -> one inline <style>.
// - The Google Fonts @import -> @font-face rules with base64 woff2 (latin only).
// Output is gitignored and asset-ignored; regenerate after changing the game.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'khanacademy.html');
// A modern UA so Google Fonts serves woff2 split by unicode-range subset.
const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

let html = readFileSync(join(root, 'index.html'), 'utf8');

// ── JS ────────────────────────────────────────────────────────────────
let js = execFileSync(
    'npx',
    ['-y', 'esbuild@0.25', 'js/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020', '--legal-comments=none'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 },
);
js = js.replace(/<\/script/gi, '<\\/script');

// ── CSS (+ inlined fonts) ─────────────────────────────────────────────
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g)].map((m) => m[1]);
let css = cssFiles.map((f) => `/* ${f} */\n` + readFileSync(join(root, f), 'utf8')).join('\n');

const fontImports = [...css.matchAll(/@import url\('(https:\/\/fonts\.googleapis\.com[^']+)'\);?/g)];
for (const [stmt, url] of fontImports) {
    const sheet = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    // Keep only the "latin" subset blocks — the game's text is English.
    const blocks = [...sheet.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face\s*{[^}]*})/g)].filter((b) => b[1] === 'latin');
    let faces = '';
    for (const [, , face] of blocks) {
        const fontUrl = face.match(/url\((https:[^)]+)\)/)[1];
        const buf = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
        faces += face.replace(fontUrl, `data:font/woff2;base64,${buf.toString('base64')}`) + '\n';
    }
    if (!faces) throw new Error(`No latin @font-face blocks found for ${url}`);
    css = faces + css.replace(stmt, '');
}
if (/@import|url\((?!['"]?data:)/.test(css)) throw new Error('CSS still references an external resource');
css = css.replace(/<\/style/gi, '<\\/style');

// ── Assemble ──────────────────────────────────────────────────────────
// Function replacers so `$` sequences in the code aren't treated as patterns.
html = html.replace(/(\s*<link rel="stylesheet" href="[^"]+"\s*\/?>)+/, () => `\n        <style>\n${css}\n        </style>`);
const entry = /<script type="module" src="js\/main\.js"><\/script>/;
if (!entry.test(html)) throw new Error('Module entry <script> not found in index.html');
html = html.replace(entry, () => `<script>\n${js}</script>`);
if (/\b(?:src|href)="(?!#|data:|javascript:)[^"]+"/.test(html)) throw new Error('HTML still references an external file');

writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
