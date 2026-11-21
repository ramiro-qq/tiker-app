import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const version = JSON.parse(read('package.json')).version;
assert.match(version, /^\d+\.\d+\.\d+$/, '桌面版本使用 major.minor.patch');
assert.equal(JSON.parse(read('package-lock.json')).version, version, 'npm lock 版本不一致');
assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, version, 'npm 根包版本不一致');
assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, version, 'Tauri 版本不一致');
assert.equal(read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1], version, 'Cargo 版本不一致');
assert.equal(read('src-tauri/Cargo.lock').match(/\[\[package\]\]\nname = "tiker"\nversion = "([^"]+)"/)?.[1], version, 'Cargo lock 版本不一致');
assert.ok(read('CHANGELOG.md').includes(`## [${version}]`), '缺少当前版本更新记录');
if (process.env.GITHUB_REF?.startsWith('refs/tags/')) {
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${version}`, '发布标签与应用版本不一致');
}
console.log(`桌面版本一致：${version}（浏览器扩展独立版本）`);
