import test from "node:test";
import assert from "node:assert/strict";
import {
  newSession,
  parseStore,
  markArchivedFile,
} from "../src/features/learning/model.ts";
test("interrupted research recovers without losing messages or drafts", () => {
  const session = newSession("理解 RAG");
  session.status = "research";
  session.files = [
    { id: "a", name: "知识讲解.md", title: "知识讲解", markdown: "# 原有材料" },
  ];
  const restored = parseStore(
    JSON.stringify({ sessions: [session], activeId: session.id }),
  );
  assert.equal(restored.sessions[0].status, "error");
  assert.match(restored.sessions[0].error, /中断/);
  assert.deepEqual(restored.sessions[0].files, session.files);
  assert.deepEqual(restored.sessions[0].messages, session.messages);
});
test("successful archive preserves all drafts, selection and conversation", () => {
  const session = newSession("理解 RAG");
  session.files = ["a", "b", "c"].map((id) => ({
    id,
    name: id + ".md",
    title: id,
    markdown: "# " + id,
  }));
  session.selectedId = "b";
  const next = markArchivedFile(session, "b");
  assert.deepEqual(
    next.files.map((f) => f.id),
    ["a", "b", "c"],
  );
  assert.equal(next.selectedId, "b");
  assert.equal(markArchivedFile(next, "b").archivedCount, 1);
  assert.deepEqual(next.messages, session.messages);
  assert.equal(next.archivedCount, 1);
  assert.equal(session.files.length, 3);
  assert.deepEqual(next.files.map(f => f.markdown), session.files.map(f => f.markdown));
  const restored = parseStore(JSON.stringify({ sessions: [next], activeId: next.id }));
  assert.equal(restored.sessions[0].files[1].archived, true);
});
test("damaged persisted learning data is rejected rather than silently overwritten", () => {
  assert.throws(() => parseStore("{broken"));
  assert.throws(() =>
    parseStore(
      JSON.stringify({
        sessions: [{ id: "a", title: "bad", messages: [], files: [{}] }],
      }),
    ),
  );
  assert.deepEqual(parseStore(null), { sessions: [], activeId: null });
});

test("materials remain closed until explicitly opened, including restored sessions", async () => {
  const { previewMaterial } = await import("../src/features/learning/model.ts");
  const session = newSession("理解 RAG");
  session.status = "ready";
  session.files = [
    { id: "a", name: "知识讲解.md", title: "知识讲解", markdown: "# 原有材料" },
  ];
  session.selectedId = "a";
  assert.equal(previewMaterial(session, null), undefined);
  assert.equal(
    previewMaterial(session, { sessionId: session.id, fileId: "a" }),
    session.files[0],
  );
  assert.equal(
    previewMaterial(session, { sessionId: "another-session", fileId: "a" }),
    undefined,
  );
  const archived = markArchivedFile(session, "a");
  assert.equal(
    previewMaterial(archived, { sessionId: session.id, fileId: "a" })?.markdown,
    session.files[0].markdown,
  );
});

test("new learning opens an empty idle conversation with a default title", () => {
  const session = newSession("");
  assert.equal(session.title, "新的学习");
  assert.equal(session.status, "idle");
  assert.deepEqual(session.messages, []);
});

test("queued inputs persist in FIFO order and force insert preserves other queued inputs", async () => {
  const { takeQueuedInput } = await import("../src/features/learning/model.ts");
  const session = newSession("理解 RAG");
  session.queued = [
    { id: "one", text: "先补充原理" },
    { id: "two", text: "再给一个案例" },
    { id: "three", text: "最后练习" },
  ];
  const fifo = takeQueuedInput(session);
  assert.equal(fifo.input.text, "先补充原理");
  assert.deepEqual(
    fifo.session.queued.map((q) => q.id),
    ["two", "three"],
  );
  const forced = takeQueuedInput(session, "two");
  assert.equal(forced.input.text, "再给一个案例");
  assert.deepEqual(
    forced.session.queued.map((q) => q.id),
    ["one", "three"],
  );
  const restored = parseStore(
    JSON.stringify({ sessions: [session], activeId: session.id }),
  );
  assert.deepEqual(restored.sessions[0].queued, session.queued);
  assert.equal(takeQueuedInput(session, "missing"), null);
});

test("interrupting a turn aborts it and late completion cannot remove the replacement turn", async () => {
  const { SessionRuns } = await import("../src/shared/agent/sessionRuns.ts");
  const runs = new SessionRuns();
  const old = runs.begin("session");
  assert.equal(runs.begin("session"), null);
  runs.interrupt("session");
  assert.equal(old.aborted, true);
  const replacement = runs.begin("session");
  assert.equal(runs.isCurrent("session", old), false);
  assert.equal(runs.finish("session", old), false);
  assert.equal(runs.isCurrent("session", replacement), true);
  assert.equal(runs.finish("session", replacement), true);
  assert.equal(runs.has("session"), false);
});

test("queue pauses at decisions and errors without consuming the next question", async () => {
  const { canAdvanceQueue } = await import("../src/features/learning/model.ts");
  const session = newSession("理解 RAG");
  session.queued = [{ id: "next", text: "解释案例" }];
  for (const status of [
    "idle",
    "classifying",
    "research",
    "clarify",
    "topic",
    "error",
  ]) {
    assert.equal(canAdvanceQueue({ ...session, status }), false, status);
  }
  assert.equal(canAdvanceQueue({ ...session, status: "ready" }), true);
  assert.equal(canAdvanceQueue({ ...session, status: "outside" }), true);
  assert.equal(
    canAdvanceQueue({ ...session, status: "ready", deletedAt: Date.now() }),
    false,
  );
  assert.equal(
    canAdvanceQueue({ ...session, status: "ready", queued: [] }),
    false,
  );
  assert.deepEqual(session.queued, [{ id: "next", text: "解释案例" }]);
});

test("model preferences discard retired requirements from older saved settings", async () => {
  const { readPreferences } = await import("../src/features/learning/preferences.ts");
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ modelId: "custom-model", requirements: "旧描述" }) };
  try {
    assert.deepEqual(readPreferences(), { modelId: "custom-model" });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
test('unmounting a workspace invalidates all in-flight session responses',async()=>{
 const {SessionRuns}=await import('../src/shared/agent/sessionRuns.ts');
 const runs=new SessionRuns(); const a=runs.begin('a'); const b=runs.begin('b');
 runs.interruptAll();
 assert.equal(a.aborted,true); assert.equal(b.aborted,true);
 assert.equal(runs.isCurrent('a',a),false);
 assert.equal(runs.has('b'),false);
});

test("entering explore selects the most recently updated undeleted session", async () => {
  const { enterLearning } = await import("../src/features/learning/model.ts");
  const older = { ...newSession("较早会话"), updatedAt: 10 };
  const latest = { ...newSession("最近会话"), updatedAt: 30 };
  const deleted = { ...newSession("已删除会话"), updatedAt: 40, deletedAt: 50 };
  const original = { sessions: [older, deleted, latest], activeId: older.id };
  const entered = enterLearning(original);
  assert.equal(entered.activeId, latest.id);
  assert.equal(original.activeId, older.id);
  assert.equal(entered.sessions, original.sessions);
  assert.equal(entered.sessions[2].status, latest.status);
  assert.equal(enterLearning({ sessions: [], activeId: null }).activeId, null);
  assert.equal(enterLearning({ sessions: [deleted], activeId: deleted.id }).activeId, null);
});

test('specified source URLs survive history trimming and interrupted research recovery', () => {
  const session=newSession('学习指定资料');
  session.sourceUrls=['https://github.com/liyupi/ai-guide'];
  session.messages=Array.from({length:30},(_,i)=>({id:String(i),role:i%2?'assistant':'user',text:'继续学习'}));
  session.status='research';
  const restored=parseStore(JSON.stringify({sessions:[session],activeId:session.id}));
  assert.deepEqual(restored.sessions[0].sourceUrls,session.sourceUrls);
  assert.equal(restored.sessions[0].status,'error');
});
test('damaged source constraints cannot silently enter a restored session', () => {
  const session=newSession('学习资料'); session.sourceUrls=[42];
  assert.throws(()=>parseStore(JSON.stringify({sessions:[session],activeId:session.id})));
});

test('legacy source attachments move to material footers without losing content', () => {
  const s = newSession('旧会话');
  s.status = 'ready';
  s.files = [
    {id:'guide',name:'指南.md',title:'指南',markdown:'# 指南\n\n正文[1]'},
    {id:'refs',name:'参考来源.md',title:'参考来源',markdown:'# 参考来源\n\n[1] [资料](https://example.com)\n\n核验局限'},
  ];
  s.selectedId = 'refs';
  const restored = parseStore(JSON.stringify({sessions:[s],activeId:s.id}));
  const session = restored.sessions[0];
  assert.equal(session.files.length, 1);
  assert.match(session.files[0].markdown, /## 参考来源/);
  assert.match(session.files[0].markdown, /核验局限/);
  assert.equal(session.selectedId, 'guide');
  assert.deepEqual(parseStore(JSON.stringify(restored)), restored);
  const sourceOnly = {...s,files:[s.files[1]]};
  assert.equal(parseStore(JSON.stringify({sessions:[sourceOnly],activeId:s.id})).sessions[0].files.length,1);
});
