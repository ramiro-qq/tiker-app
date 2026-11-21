import { PreviewError } from '../contracts';
export function abortCheck(signal: AbortSignal) { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); }
// Bounded streaming reader. A server ignoring Range cannot cause an unbounded allocation.
export async function readText(url: string, signal: AbortSignal, max = 2 * 1024 * 1024) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${max}` } });
  if (response.status === 416 && response.headers.get('Content-Range') === 'bytes */0') return { text: '', encoding: 'UTF-8', truncated: false };
  if (!response.ok) throw new PreviewError('access', '无法读取文件，请重新选择或检查文件权限。');
  const reader = response.body?.getReader();
  if (!reader) throw new PreviewError('access', '当前环境无法读取文件。');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (length <= max) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = value.subarray(0, max + 1 - length); chunks.push(chunk); length += chunk.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  abortCheck(signal);
  const bytes = new Uint8Array(Math.min(length, max)); let offset = 0;
  for (const chunk of chunks) { const n = Math.min(chunk.length, bytes.length - offset); bytes.set(chunk.subarray(0, n), offset); offset += n; }
  let encoding = 'UTF-8'; let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'UTF-16LE'; text = new TextDecoder('utf-16le').decode(bytes); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'UTF-16BE'; text = new TextDecoder('utf-16be').decode(bytes); }
  else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: length > max }); }
    catch { encoding = 'GB18030（自动推测）'; text = new TextDecoder('gb18030').decode(bytes); } }
  if (text.includes('\0')) throw new PreviewError('unsupported', '检测到二进制内容，无法按文本预览。');
  return { text, encoding, truncated: length > max };
}
export function findText(root: HTMLElement, query: string): number {
  root.querySelectorAll('mark.pv-match').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent || ''))); root.normalize();
  if (!query) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let count = 0;
  for (const node of nodes) {
    const value = node.data; let offset = 0; let at = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (at < 0) continue;
    const fragment = document.createDocumentFragment();
    while (at >= 0 && count < 2000) { fragment.append(value.slice(offset, at)); const mark = document.createElement('mark'); mark.className = 'pv-match'; mark.textContent = value.slice(at, at + query.length); fragment.append(mark); count++; offset = at + query.length; at = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), offset); }
    fragment.append(value.slice(offset)); node.replaceWith(fragment); if (count >= 2000) break;
  }
  root.querySelector('mark')?.scrollIntoView({ block: 'center' }); return count;
}
