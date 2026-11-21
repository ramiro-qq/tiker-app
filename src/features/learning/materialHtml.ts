import createDOMPurify from 'dompurify';
import { marked } from 'marked';

// A dedicated sanitizer avoids changing the policy of unrelated readers/editors.
const purifier = createDOMPurify(window);
purifier.addHook('afterSanitizeAttributes', node => {
  if (node.nodeName !== 'IMG') return;
  const src = node.getAttribute('src') ?? '';
  // Portable embedded illustrations only. Never load model-supplied remote/tracking resources.
  if (!/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > 100_000) {
    node.remove();
    return;
  }
  for (const attr of Array.from(node.attributes)) {
    if (!['src', 'alt', 'title'].includes(attr.name)) node.removeAttribute(attr.name);
  }
});
export function sanitizeMaterialHtml(html: string): string {
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style'],
  });
}
export function materialHtml(markdown: string): string {
  return sanitizeMaterialHtml(marked.parse(markdown, { async: false }));
}
