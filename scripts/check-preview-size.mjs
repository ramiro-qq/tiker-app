import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir,name); return statSync(path).isDirectory() ? walk(path) : [{ path, bytes: statSync(path).size }]; });
const files = walk('dist'); const html = readFileSync('dist/index.html','utf8'); const entry = html.match(/<script[^>]*src="([^"]+)"/)?.[1];
if (!entry) throw new Error('找不到生产入口');
const entryPath = join('dist',entry.replace(/^\//,'')); const entryGzip = gzipSync(readFileSync(entryPath)).length;
const baseline = { entryGzip: 98931, frontendAssets: 403681 }; // Successful build captured before preview implementation, 2026-11-13.
const totalBytes = files.reduce((n,f)=>n+f.bytes,0);
const report = { totalBytes, entryGzip, baseline, entryGzipDelta: entryGzip-baseline.entryGzip, conservativeWebDelta: totalBytes-baseline.frontendAssets, files };
console.log(JSON.stringify({ ...report, files: `${files.length} files (details available in report file)` },null,2));
if (process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
if (entryGzip-baseline.entryGzip > 30*1024 || totalBytes-baseline.frontendAssets > 15*1024*1024) throw new Error('预览体积超出首屏或完整资源预算');
if (files.some(f=>/\.map$/.test(f.path))) throw new Error('分发资源包含 source map，请检查资源复制规则');
