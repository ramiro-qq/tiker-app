import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './generate-extension-icons.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const archive = fileURLToPath(new URL('../public/downloads/tiker-clipper.zip', import.meta.url));
mkdirSync(new URL('../public/downloads/', import.meta.url), { recursive: true });
rmSync(archive, { force: true });
// zip is available on macOS/Linux; PowerShell provides the equivalent on Windows.
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path 'browser-extension/*' -DestinationPath 'public/downloads/tiker-clipper.zip' -Force`], { cwd: root });
} else {
  execFileSync('zip', ['-q', '-r', archive, 'manifest.json', 'background.js', 'clip-link.js', 'icons', 'README.md'], { cwd: new URL('../browser-extension/', import.meta.url) });
}
console.log('已生成 public/downloads/tiker-clipper.zip');
