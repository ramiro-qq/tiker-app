import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = 'public/pdf'; mkdirSync(root, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(`node_modules/pdfjs-dist/${name}`, join(root, name), { recursive: true });
cpSync('node_modules/pdfjs-dist/LICENSE', join(root, 'LICENSE'));
const bytes = dir => readdirSync(dir).reduce((sum, file) => sum + (statSync(join(dir, file)).isDirectory() ? bytes(join(dir, file)) : statSync(join(dir, file)).size), 0);
writeFileSync(join(root, 'version.json'), JSON.stringify({ version: JSON.parse((await import('node:fs')).readFileSync('node_modules/pdfjs-dist/package.json', 'utf8')).version }));
console.log(`PDF 离线资源 ${(bytes(root) / 1024 / 1024).toFixed(2)} MiB`);
