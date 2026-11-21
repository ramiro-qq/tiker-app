const diagnosticPrefix = '检索后未获得与学习主题实质相关且可读取的资料';

// Remove the old, automatically prepended retrieval diagnostics. Ordinary
// quotes and the author's own source/status explanations remain document data.
export function cleanDocumentContent(html: string): string {
  if (!html.includes(diagnosticPrefix)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const first = document.body.firstElementChild;
  if (first?.tagName !== 'BLOCKQUOTE' || !first.textContent?.trim().startsWith(diagnosticPrefix)) return html;
  first.remove();
  return document.body.innerHTML;
}
