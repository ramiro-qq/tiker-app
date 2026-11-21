// Test-only setup through the real content service; no runtime demo routes.
export function openTestLibrary(browser, base, variant = '') {
  const url = new URL(base); url.searchParams.delete('board');
  browser('open', url.href);
  browser('wait', '.app-navigation');
  browser('eval', `(async()=>{const {libraryFixture}=await import('/scripts/fixtures/documents.ts');const {content}=await import('/src/services/content.ts');const nodes=libraryFixture(${JSON.stringify(variant)});if(!${JSON.stringify(variant)})nodes.find(n=>n.id==='knowledge').title='知识管理';content.saveLibrary(nodes);await content.flush();})()`);
  browser('click', '.app-navigation [aria-label="文档"]');
  browser('wait', '.lb-workspace');
}
export function openTestDocument(browser, base, variant = '') {
  openTestLibrary(browser, base, variant);
  browser('click', '.library-shortcuts button');
  browser('click', '.lb-list-row>button:first-child');
  browser('wait', '.te-content');
}
