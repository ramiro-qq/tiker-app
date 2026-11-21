import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function files(path) { return readdirSync(new URL('../' + path, import.meta.url), {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : /\.(ts|tsx)$/.test(entry.name) ? [`${path}/${entry.name}`] : []); }
test('application sources contain no demo generators or design fixture imports', () => {
  for (const path of files('src')) assert.doesNotMatch(source(path), /seedLibrary|libraryFixture|clipPreview|fixtureTraces|import\(["'][^"']*fixtures["']\)|ramiro-qg|ABCD-EFGH/, path);
});
test('fresh browser storage starts with an empty library', () => {
  assert.match(source('src/services/content.ts'), /legacy\('tiker.library.v1'\) \?\? \[\]/);
});
test('design board URLs cannot activate demo pages', () => {
  assert.doesNotMatch(source('src/App.tsx'), /get\(["']board["']\)|readerBoards|historyBoards|TagsView|HistoryView/);
});
