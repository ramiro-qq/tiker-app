export function buildClipLink(pageUrl, title = '', requestId = crypto.randomUUID()) {
  const page = new URL(pageUrl);
  if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password || page.href.length > 16000) {
    throw new Error('仅支持剪藏 HTTP / HTTPS 网页，请打开普通网页后重试。');
  }
  const link = new URL('aireader://clip');
  link.search = new URLSearchParams({ url: page.href, title: title.slice(0, 500), requestId }).toString();
  return link.href;
}
