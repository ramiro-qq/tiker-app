import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClipLink } from '../browser-extension/clip-link.js';

const handlers = {};
const navigations = [];
const badges = [];
const titles = [];
let menu;
let failNavigation = false;
globalThis.chrome = {
  runtime: { onInstalled: {addListener: fn => {handlers.install = fn;}} },
  contextMenus: { removeAll: fn => fn(), create: options => {menu = options;}, onClicked: {addListener: fn => {handlers.context = fn;}} },
  action: {
    onClicked: {addListener: fn => {handlers.toolbar = fn;}},
    setBadgeText: async options => badges.push(options),
    setBadgeBackgroundColor: async () => {},
    setTitle: async options => titles.push(options),
  },
  tabs: {
    create: () => {throw new Error('Clipping must never create a tab');},
    remove: () => {throw new Error('Clipping must never close the source tab');},
    update: async (id, options) => {
      if (failNavigation) throw new Error('无法唤起 Tiker');
      navigations.push({id, ...options});
    },
  },
};
await import('../browser-extension/background.js');
const result = () => new URL(navigations.at(-1).url);
test('protocol preserves Chinese title, query and fragment', () => {
  const page = 'https://example.com/article?q=%E4%B8%AD%E6%96%87&x=1#part';
  const link = new URL(buildClipLink(page, '中文 & 标题 #1', 'test-123'));
  assert.equal(link.protocol, 'aireader:');
  assert.equal(link.host, 'clip');
  assert.equal(link.searchParams.get('url'), page);
  assert.equal(link.searchParams.get('title'), '中文 & 标题 #1');
  assert.equal(link.searchParams.get('requestId'), 'test-123');
});
test('rejects internal pages, credentials and oversized URLs', () => {
  for (const page of ['chrome://extensions', 'file:///tmp/a', 'javascript:alert(1)', 'https://user:password@example.com', 'bad', `https://example.com/${'a'.repeat(16000)}`]) assert.throws(() => buildClipLink(page));
});
test('toolbar requests external protocol from source tab without helper pages', async () => {
  handlers.install();
  assert.equal(menu.title, '一键剪藏');
  assert.ok(menu.contexts.includes('action'));
  await handlers.toolbar({id:7,url:'https://example.com/page',title:'当前页面'});
  assert.equal(navigations.at(-1).id, 7);
  assert.equal(result().searchParams.get('url'), 'https://example.com/page');
  assert.equal(result().searchParams.get('title'), '当前页面');
});
test('right click clips containing page; repeated clips use same tab and unique IDs', async () => {
  const info = {menuItemId:'ai-reader-clip',pageUrl:'https://example.com/page',linkUrl:'https://other.com/resource'};
  const tab = {id:8,title:'页面'};
  await handlers.context(info, tab);
  const id = result().searchParams.get('requestId');
  await handlers.context(info, tab);
  assert.equal(navigations.at(-1).id, 8);
  assert.equal(result().searchParams.get('url'), 'https://example.com/page');
  assert.notEqual(result().searchParams.get('requestId'), id);
});
test('invalid pages and protocol API errors show toolbar error; next attempt clears it', async () => {
  const before = navigations.length;
  await handlers.toolbar({id:9,url:'chrome://settings',title:'设置'});
  assert.equal(navigations.length, before);
  assert.equal(badges.at(-1).text, '!');
  failNavigation = true;
  await handlers.toolbar({id:9,url:'https://example.com'});
  assert.equal(titles.at(-1).title, '无法唤起 Tiker');
  failNavigation = false;
  await handlers.toolbar({id:9,url:'https://example.com'});
  assert.equal(badges.at(-1).text, '');
  assert.equal(titles.at(-1).title, '一键剪藏到 Tiker');
  await handlers.toolbar({url:'https://example.com'});
});
