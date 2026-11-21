import test from 'node:test';
import assert from 'node:assert/strict';
import { github, githubAccess, githubError } from '../src/services/github.ts';
let invoke = async () => { throw new Error('Unexpected IPC'); };
globalThis.isTauri = true;
globalThis.window = { isTauri: true, __TAURI_INTERNALS__: { invoke: (...args) => invoke(...args) } };

test('credential failures reach every subscriber, preserve recovery information, and can be retried', async () => {
  const observed = [];
  const unsubscribe = githubAccess.subscribe(() => observed.push(githubAccess.getSnapshot().state));
  invoke = async () => { throw { code: 'credential_unavailable', message: '系统错误 -25293' }; };
  await assert.rejects(github.repositories(), error => githubError(error) === '系统错误 -25293');
  assert.equal(githubAccess.getSnapshot().state, 'credential_unavailable');
  assert.deepEqual(observed, ['checking', 'credential_unavailable']);
  unsubscribe();
  assert.equal(githubAccess.getSnapshot().state, 'credential_unavailable'); // Remount does not reset failure.
  invoke = async () => [];
  assert.deepEqual(await github.repositories(), []);
  assert.equal(githubAccess.getSnapshot().state, 'ready');
});
test('listing, creation and binding share the same invalid-token recovery state', async () => {
  invoke = async () => { throw { code: 'unauthorized', message: '授权失效' }; };
  for (const operation of [() => github.repositories(), () => github.create('notes', '', true), () => github.bind('user/notes')]) {
    await assert.rejects(operation());
    assert.equal(githubAccess.getSnapshot().state, 'unauthorized');
  }
  invoke = async () => ({ status: 'pending', interval: 5, account: null });
  await github.poll(1);
  assert.equal(githubAccess.getSnapshot().state, 'unauthorized');
  invoke = async () => ({ status: 'authorized', interval: 0, account: { user: { login: 'user' }, repository: null } });
  await github.poll(1);
  assert.equal(githubAccess.getSnapshot().state, 'ready');
});
test('network and permission failures are distinct from lost credentials; disconnect clears runtime state', async () => {
  for (const code of ['network', 'forbidden', 'credential_missing', 'account_mismatch']) {
    invoke = async () => { throw { code, message: code }; };
    await assert.rejects(github.repositories());
    assert.equal(githubAccess.getSnapshot().state, code);
  }
  invoke = async () => undefined;
  await github.disconnect();
  assert.equal(githubAccess.getSnapshot().state, 'unchecked');
});

test('authorization survives transient network failure without cancelling or replacing the device session', async t => {
  const { watchGithubAuthorization } = await import('../src/services/github.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let polls = 0;
  const cancelled = [];
  const authorized = [];
  const failures = [];
  invoke = async (command, args) => {
    if (command === 'github_cancel_auth') { cancelled.push(args.sessionId); return; }
    assert.equal(args.sessionId, 42);
    if (++polls === 1) throw { code: 'network', message: 'temporary outage' };
    return { status: 'authorized', interval: 0, account: { user: { login: 'user' }, repository: null } };
  };
  const stop = watchGithubAuthorization({ sessionId: 42, interval: 5 }, account => authorized.push(account), error => failures.push(error));
  t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 1);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(failures, []);
  t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(authorized.length, 1);
  stop();
  assert.deepEqual(cancelled, []);
});

test('closing authorization cancels scheduled retries; revoked access fails immediately', async t => {
  const { watchGithubAuthorization } = await import('../src/services/github.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let polls = 0;
  let cancellations = 0;
  let code = 'network';
  const failures = [];
  invoke = async command => {
    if (command === 'github_cancel_auth') { cancellations++; return; }
    polls++; throw { code, message: code };
  };
  const device = { sessionId: 42, interval: 5 };
  const stop = watchGithubAuthorization(device, () => assert.fail(), error => failures.push(error));
  t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  stop();
  t.mock.timers.tick(60000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 1);
  assert.equal(cancellations, 1);
  code = 'unauthorized';
  const stopRevoked = watchGithubAuthorization(device, () => assert.fail(), error => failures.push(error));
  t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failures.length, 1);
  stopRevoked();
});

test('persistent network errors stop after three retries and do not request a new code', async t => {
  const { watchGithubAuthorization } = await import('../src/services/github.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let polls = 0;
  const failures = [];
  invoke = async command => {
    if (command === 'github_cancel_auth') return;
    assert.equal(command, 'github_poll_auth');
    polls++; throw { code: 'network', message: 'offline' };
  };
  const stop = watchGithubAuthorization({ sessionId: 42, interval: 5 }, () => assert.fail(), error => failures.push(error));
  for (const delay of [5000, 5000, 10000, 20000]) {
    t.mock.timers.tick(delay);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(polls, 4);
  assert.equal(failures.length, 1);
  stop();
});

test('a temporary error during reauthorization never restores the stale repository card state', async () => {
  invoke = async () => { throw { code: 'unauthorized', message: 'expired' }; };
  await assert.rejects(github.repositories());
  invoke = async () => { throw { code: 'network', message: 'offline' }; };
  await assert.rejects(github.poll(42));
  assert.equal(githubAccess.getSnapshot().state, 'unauthorized');
});

test('application preferences and synchronization settings use independent save commands', async () => {
  const { defaultAppConfig, queueConfigSave } = await import('../src/config/appConfig.ts');
  const { loadSyncSettings, saveSyncDelay } = await import('../src/config/syncConfig.ts');
  const calls = [];
  const settings = { autoSyncDelaySeconds: 4, github: { initialized: true, user: { login: 'alice' }, repository: null } };
  invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'load_sync_settings') return structuredClone(settings);
    if (command === 'save_sync_delay') return { ...settings, autoSyncDelaySeconds: args.seconds };
    if (command === 'save_app_config') return args.config;
    assert.fail(`Unexpected command: ${command}`);
  };
  assert.deepEqual(await loadSyncSettings(), settings);
  await Promise.all([queueConfigSave(structuredClone(defaultAppConfig)), saveSyncDelay(10)]);
  const appSave = calls.find(c => c.command === 'save_app_config').args.config;
  assert.equal('github' in appSave, false);
  assert.equal('autoRecordInterval' in appSave.app, false);
  assert.deepEqual(calls.find(c => c.command === 'save_sync_delay').args, { seconds: 10 });
});

test('a failed synchronization setting save can be retried without blocking application saves', async () => {
  const { defaultAppConfig, queueConfigSave } = await import('../src/config/appConfig.ts');
  const { saveSyncDelay } = await import('../src/config/syncConfig.ts');
  let failed = false;
  invoke = async (command, args) => {
    if (command === 'save_app_config') return args.config;
    if (!failed) { failed = true; throw 'disk unavailable'; }
    return { autoSyncDelaySeconds: args.seconds, github: { initialized: true, user: null, repository: null } };
  };
  await assert.rejects(saveSyncDelay(2));
  await queueConfigSave(structuredClone(defaultAppConfig));
  assert.equal((await saveSyncDelay(10)).autoSyncDelaySeconds, 10);
});
