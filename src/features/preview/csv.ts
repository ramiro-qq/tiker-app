export function parseDelimited(text: string, delimiter: string, maxCells = 1_000_000): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false; let cells = 0;
  const endField = () => { if (++cells > maxCells) throw new Error('表格超过 100 万单元格预览限制。'); row.push(field); field = ''; closed = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += ch; continue; }
    if (ch === delimiter) endField();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else if (ch === '"' && !field && !closed) quoted = true;
    else { if (closed || ch === '"') throw new Error('表格引号格式不正确，请使用系统应用检查原文件。'); field += ch; }
  }
  if (quoted) throw new Error('表格中存在未闭合的引号。');
  if (field || row.length || closed) endRow();
  return rows;
}
