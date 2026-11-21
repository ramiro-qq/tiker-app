import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './generate-app-icon-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
execFileSync(process.execPath, [cli, 'icon', 'src-tauri/icons/app-icon.svg', '--output', 'src-tauri/icons'], { cwd: root, stdio: 'inherit' });
await import('./generate-extension-icons.mjs');
