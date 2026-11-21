import { openTestDocument } from './fixtures/browser.mjs';
// Run with the dev server and agent-browser installed. Uses isolated fixture data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const session = `editor-test-${process.pid}`;
function browser(...args) {
  if (args[0] === 'click') { browser('scrollintoview', args[1]); browser('wait', '80'); }
  const r = spawnSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout);
  return r.stdout;
}
const evaluate = js => JSON.parse(browser('eval', js));
function insertBlock(label) {
  // Set up an empty insertion point in this isolated fixture, then use the real slash menu.
  browser('eval', "document.querySelector('.te-content').editor.chain().focus('end').insertContent('<p></p>').run()");
  browser('wait', '80');
  browser('type', '.te-content', '/' + label.split(' ')[0]); browser('wait', '.te-slash');
  browser('find', 'role', 'option', 'click', '--name', label, '--exact');
}

test('Markdown input, custom highlighter, tables, Mermaid, export and reopen', () => {
    const assertFocus = () => {
      const styles = evaluate("({outline:getComputedStyle(document.activeElement).outlineStyle,shadow:getComputedStyle(document.activeElement).boxShadow})");
      assert.equal(styles.outline, 'none'); assert.equal(styles.shadow, 'none');
    };
  try {
    const url = new URL(process.env.READER_TEST_URL || 'http://127.0.0.1:1420/');
    openTestDocument(browser, url.href); browser('wait', '.te-content');
    browser('wait', '--fn', "document.querySelector('.rd-toc nav').children.length > 0");
    browser('eval', "document.querySelector('.te-content').editor.commands.clearContent()"); browser('click', '.te-content'); browser('type', '.te-content', '#'); browser('press', 'Space');
    browser('type', '.te-content', '编辑器回归');
    assert.equal(evaluate("!!document.querySelector('.te-content h1')"), true);
    browser('press', 'Enter'); browser('type', '.te-content', '/');
    browser('wait', '.te-slash');
    browser('click', '.te-slash [role=option]');
    assert.equal(evaluate("!!document.querySelector('.te-slash')"), false);
    insertBlock('高亮块');
    browser('wait', '.te-callout');
    browser('press', 'Meta+z');
    assert.equal(evaluate("!!document.querySelector('.te-callout')"), false);
    browser('press', 'Meta+Shift+z'); browser('wait', '.te-callout');
    insertBlock('表格'); browser('wait', '80'); browser('wait', '.te-content table');
    browser('find', 'role', 'button', 'click', '--name', '添加行', '--exact');
    browser('wait', '--fn', "document.querySelectorAll('.te-content table tr').length === 4");
    insertBlock('Mermaid 图表');
    browser('wait', '600');
    browser('wait', '--fn', "!!document.querySelector('.te-diagram svg text')");
    assert.ok(evaluate("[...document.querySelectorAll('.te-diagram svg text')].map(e=>e.textContent).join('')").includes('开始'));
    browser('click', '.te-diagram header button');
    assertFocus();
    browser('fill', '[aria-label="Mermaid 语法"]', 'not a diagram');
    browser('wait', '600'); browser('wait', '--fn', "!!document.querySelector('.te-diagram [role=alert]')");
    browser('fill', '[aria-label="Mermaid 语法"]', 'flowchart LR\n A[修改] --> B[成功]');
    browser('wait', '600');
    browser('wait', '--fn', "document.querySelector('.te-diagram svg')?.textContent.includes('修改')");
    browser('click', '.te-diagram header button');
    browser('click', '.te-content h1'); assertFocus();
    browser('focus', '.rd-tag-trigger'); browser('press', 'Tab'); assertFocus();
    browser('click', '.rd-tag-trigger'); browser('wait', '[aria-label="搜索或创建标签"]'); assertFocus();
    browser('press', 'Escape');
    browser('find', 'role', 'button', 'click', '--name', '移动到', '--exact');
    browser('wait', 'dialog[open]'); assertFocus();
    browser('press', 'Shift+Tab'); assertFocus();
    assert.equal(evaluate('document.activeElement.getAttribute("aria-label")'), '关闭移动到');
    browser('press', 'Escape');
    // Observe the actual exported Blob, so Markdown syntax and custom nodes are tested.
    browser('eval', "window.editorExport = null; window.originalCreateObjectURL = URL.createObjectURL; HTMLAnchorElement.prototype.click = function() { if (!this.download) throw new Error('Unexpected navigation'); }; URL.createObjectURL = blob => { blob.text().then(text => window.editorExport = text); return window.originalCreateObjectURL(blob); }");
    browser('click', '[aria-label="更多文档操作"]'); browser('find', 'role', 'menuitem', 'click', '--name', '导出');
    browser('wait', '--fn', 'window.editorExport !== null');
    const markdown = evaluate('window.editorExport');
    assert.match(markdown, /# 编辑器回归/);
    assert.match(markdown, /```mermaid/);
    assert.match(markdown, /data-type="callout"/);
    assert.match(markdown, /A\[修改\]/);
    assert.doesNotMatch(markdown, /mermaidEditing/);
    browser('click', '.library-shortcuts button');
    browser('click', '.lb-list-row>button:first-child'); browser('wait', '.te-content');
    assert.equal(evaluate("!!document.querySelector('.te-callout') && !!document.querySelector('.te-content table')"), true);
    browser('wait', '600');
    browser('wait', '--fn', "!!document.querySelector('.te-diagram svg text')");
    assert.ok(evaluate("document.querySelector('.te-diagram svg').textContent").includes('修改'));
    assert.equal(browser('errors').trim(), '');
  } finally { browser('close'); }
});

test('full breadcrumbs, removal of generated diagnostics, and document typography at every viewport', () => {
  try {
    const url = new URL(process.env.READER_TEST_URL || 'http://127.0.0.1:1420/');
    openTestDocument(browser, url.href, 'reader-style'); browser('wait', '.te-content img');
    const path = evaluate("[...document.querySelectorAll('.rd-breadcrumbs li')].map(e=>e.textContent)");
    assert.deepEqual(path, ['产品与设计','方案研究','客户试点','产品方案 POC：从选型到验收的协作指南']);
    assert.equal(evaluate("document.querySelector('.rd-breadcrumbs [aria-current=page]').textContent"), path.at(-1));
    assert.equal(evaluate("document.querySelector('.rd-root').innerText.includes('修改自动保存到本机') || !!document.querySelector('.te-toolbar')"), false);
    assert.equal(evaluate("document.querySelector('.te-content').innerText.includes('检索后未获得')"), false);
    assert.match(evaluate("document.querySelector('.te-content blockquote').textContent"), /资料状态：以下为团队自己的说明/);
    const styles = evaluate(`(() => {
      const style = selector => getComputedStyle(document.querySelector('.te-content '+selector));
      const rect = selector => document.querySelector('.te-content '+selector).getBoundingClientRect();
      return {
        sizes:['h1','h2','h3','p'].map(s=>parseFloat(style(s).fontSize)),
        quoteBg:style('blockquote').backgroundColor, quoteBorder:style('blockquote').borderLeftWidth,
        headingMargin:parseFloat(style('h2').marginTop), paragraphMargin:parseFloat(style('p').marginTop),
        rule:style('hr').borderTopWidth, headerBg:style('th').backgroundColor,
        cellPadding:parseFloat(style('td').paddingLeft), imageRatio:rect('img').width/rect('img').height,
        imageMax:style('img').maxWidth, calloutBg:style('.te-callout').backgroundColor
      };
    })()`);
    assert.ok(styles.sizes.every((size,i,a)=>i===0 || a[i-1]>size));
    assert.equal(styles.quoteBg,'rgb(245, 247, 252)'); assert.equal(styles.quoteBorder,'3px');
    assert.ok(styles.headingMargin>styles.paragraphMargin); assert.equal(styles.rule,'1px');
    assert.notEqual(styles.headerBg,'rgba(0, 0, 0, 0)'); assert.ok(styles.cellPadding>=12);
    assert.ok(Math.abs(styles.imageRatio-640/180)<0.01); assert.equal(styles.imageMax,'100%');
    assert.notEqual(styles.calloutBg,styles.quoteBg);
    for (const width of [2526,1440,760,390]) {
      browser('set','viewport',String(width),'1000');
      browser('eval', 'document.getAnimations().forEach(a=>a.finish())');
      const result=evaluate(`(() => {
        const header=document.querySelector('.rd-topbar');
        const crumbs=[...document.querySelectorAll('.rd-breadcrumbs li span')];
        const bounds=header.getBoundingClientRect();
        const image=document.querySelector('.te-content img').getBoundingClientRect();
        const content=document.querySelector('.te-content').getBoundingClientRect();
        return {overflow:header.scrollWidth-header.clientWidth, clipped:crumbs.some(e=>e.scrollWidth>e.clientWidth+1 || e.getBoundingClientRect().bottom>bounds.bottom+1), imageOverflow:image.width-content.width};
      })()`);
      assert.ok(result.overflow<=1,`header overflow at ${width}`);
      assert.equal(result.clipped,false,`breadcrumb clipped at ${width}`);
      assert.ok(result.imageOverflow<=1,`image overflow at ${width}`);
    }
    const cleanup=evaluate(`(async () => {
      const {cleanDocumentContent}=await import('/src/features/editor/documentContent.ts');
      const own='<blockquote><p>资料状态：作者保留的说明</p></blockquote><p>正文</p>';
      const inline='<p>检索后未获得与学习主题实质相关且可读取的资料</p>';
      return {own:cleanDocumentContent(own)===own, inline:cleanDocumentContent(inline)===inline};
    })()`);
    assert.deepEqual(cleanup,{own:true,inline:true});
    // Reopen the cleaned fixture document through the real library list.
    browser('set','viewport','1440','1000');
    browser('click', '.library-shortcuts button');
    browser('click', '.lb-list-row>button:first-child'); browser('wait','.te-content');
    assert.equal(evaluate("document.querySelector('.te-content').innerText.includes('检索后未获得')"),false);
    assert.match(evaluate("document.querySelector('.te-content blockquote').textContent"),/资料状态/);
    assert.equal(browser('errors').trim(),'');
  } finally { browser('close'); }
});
