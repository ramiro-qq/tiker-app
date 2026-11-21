import type { PreviewFormat } from './contracts';
const textExtensions = new Set('txt log json jsonl yaml yml xml html htm css js jsx ts tsx vue svelte py go rs java c h cpp sh sql ini toml conf'.split(' '));
export function detectFormat(name: string, mime = ''): PreviewFormat {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (textExtensions.has(ext) || mime === 'text/plain') return 'text';
  return 'unsupported';
}
export function validateSize(format: PreviewFormat, size: number) {
  const limit = format === 'pdf' ? 200 : format === 'image' ? 40 : 10;
  if (format !== 'unsupported' && size > limit * 1024 * 1024) throw new Error(`文件超过 ${limit} MiB 预览限制，请使用系统应用打开。`);
}
