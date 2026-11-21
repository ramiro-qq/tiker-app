import type { PreviewFile, PreviewRegistration } from '../contracts';
import { PreviewError } from '../contracts';
// Build manifest: only enabled implementations are referenced, including dynamic imports.
// Replacing an engine changes this manifest and its adapter, never the Reader or file service.
export const registrations: PreviewRegistration[] = [
  { id: 'native-image', formats: ['image'], load: () => import('./imageAdapter').then(m => m.createAdapter) },
  { id: 'plain-text', formats: ['text'], load: () => import('./textAdapter').then(m => m.createAdapter) },
  { id: 'markdown', formats: ['markdown'], load: () => import('./markdownAdapter').then(m => m.createAdapter) },
  { id: 'csv', formats: ['csv'], load: () => import('./csvAdapter').then(m => m.createAdapter) },
  { id: 'pdfjs', formats: ['pdf'], load: () => import('./pdfAdapter').then(m => m.createAdapter) },
];
export async function createEngine(file: PreviewFile) {
  const registration = registrations.find(item => item.formats.includes(file.format));
  if (!registration) throw new PreviewError('unsupported', '此格式暂不支持内置预览，可使用系统应用打开或另存原文件。');
  return (await registration.load())();
}
