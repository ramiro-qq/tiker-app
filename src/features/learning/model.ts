import type { Source } from "../../shared/agent/contracts";
export type { Source } from "../../shared/agent/contracts";
export type LearningStatus =
  | "idle"
  | "classifying"
  | "clarify"
  | "outside"
  | "topic"
  | "research"
  | "ready"
  | "error";
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}
export interface Material {
  archived?: boolean;
  status?: 'generating' | 'ready' | 'error' | 'stopped';
  id: string;
  name: string;
  title: string;
  markdown: string;
}

export interface QueuedInput {
  id: string;
  text: string;
}
export interface LearningSession {
  sourceUrls?: string[];
  queued?: QueuedInput[];
  deletedAt?: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: LearningStatus;
  messages: Message[];
  files: Material[];
  selectedId: string | null;
  pending: string;
  pendingTitle?: string;
  sources: Source[];
  stage: number;
  error: string;
  archivedCount: number;
}
export interface LearningStore {
  sessions: LearningSession[];
  activeId: string | null;
}
// Entering Explore resumes the latest live session without altering its work or order.
export function enterLearning(store: LearningStore): LearningStore {
  const latest = store.sessions.reduce<LearningSession | undefined>((recent, session) => {
    if (session.deletedAt) return recent;
    return !recent || session.updatedAt > recent.updatedAt ? session : recent;
  }, undefined);
  return { ...store, activeId: latest?.id ?? null };
}
export interface MaterialPreview {
  sessionId: string;
  fileId: string;
}
// A generated or previously selected file alone never opens the reader.
export function previewMaterial(
  session: LearningSession | undefined,
  preview: MaterialPreview | null,
): Material | undefined {
  if (!session || preview?.sessionId !== session.id) return undefined;
  return session.files.find((file) => file.id === preview.fileId);
}
export const learningKey = "tiker.learning.v1";
export const libraryKey = "tiker.library.v1";
export const message = (role: Message["role"], text: string): Message => ({
  id: crypto.randomUUID(),
  role,
  text,
});
export function newSession(text: string): LearningSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: text.trim().slice(0, 28) || "新的学习",
    createdAt: now,
    updatedAt: now,
    status: text.trim() ? "classifying" : "idle",
    messages: text.trim() ? [message("user", text)] : [],
    queued: [],
    files: [],
    selectedId: null,
    pending: text,
    sources: [],
    stage: 0,
    error: "",
    archivedCount: 0,
  };
}
// Preserve old source content while retiring the separate attachment. A source-only
// recovery is kept intact rather than discarding the only surviving file.
function mergeLegacyReferences(session: LearningSession): LearningSession {
  const refs = session.files.filter(file => file.name === '参考来源.md');
  const materials = session.files.filter(file => file.name !== '参考来源.md');
  if (!refs.length || !materials.length) return session;
  const footer = refs.map(file => file.markdown.replace(/^# 参考来源\s*/, '').trim()).join('\n\n');
  return {
    ...session,
    files: materials.map(file => ({ ...file, markdown: `${file.markdown.trimEnd()}\n\n## 参考来源\n\n${footer}` })),
    selectedId: refs.some(file => file.id === session.selectedId) ? materials[0].id : session.selectedId,
  };
}

export function parseStore(raw: string | null): LearningStore {
  if (!raw) return { sessions: [], activeId: null };
  const data = JSON.parse(raw) as LearningStore;
  const statuses = [
    "idle",
    "classifying",
    "clarify",
    "outside",
    "topic",
    "research",
    "ready",
    "error",
  ];
  if (
    !data ||
    !Array.isArray(data.sessions) ||
    !data.sessions.every(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.title === "string" &&
        statuses.includes(s.status) &&
        typeof s.createdAt === "number" &&
        typeof s.updatedAt === "number" &&
        typeof s.pending === "string" &&
        typeof s.error === "string" &&
        typeof s.stage === "number" &&
        (s.sourceUrls === undefined || (Array.isArray(s.sourceUrls) && s.sourceUrls.length <= 3 && s.sourceUrls.every(url => typeof url === "string" && url.length <= 8192))) &&
        typeof s.archivedCount === "number" &&
        (s.deletedAt === undefined || typeof s.deletedAt === "number") &&
        (s.queued === undefined ||
          (Array.isArray(s.queued) &&
            s.queued.every(
              (q) =>
                q &&
                typeof q.id === "string" &&
                typeof q.text === "string" &&
                q.text.length <= 4000,
            ))) &&
        Array.isArray(s.messages) &&
        s.messages.every(
          (m) =>
            m &&
            typeof m.id === "string" &&
            ["user", "assistant"].includes(m.role) &&
            typeof m.text === "string",
        ) &&
        Array.isArray(s.sources) &&
        s.sources.every(
          (source) =>
            source &&
            typeof source.title === "string" &&
            typeof source.url === "string" &&
            typeof source.excerpt === "string",
        ) &&
        Array.isArray(s.files) &&
        s.files.every(
          (f) =>
            f &&
            typeof f.markdown === "string" &&
            typeof f.id === "string" &&
            typeof f.title === "string" &&
            typeof f.name === "string",
        ),
    )
  )
    throw new Error("学习记录格式损坏，请先备份本机数据。");
  return {
    sessions: data.sessions.map(mergeLegacyReferences).map((s) =>
      ["research", "classifying"].includes(s.status)
        ? {
            ...s,
            status: "error",
            files: s.files.map(file => file.status === "generating" ? {...file,status:"stopped" as const} : file),
            error: "上次研究被中断，已保留会话和材料，请重试。",
          }
        : s,
    ),
    activeId: data.activeId,
  };
}
export function markArchivedFile(session: LearningSession, fileId: string): LearningSession {
  const file = session.files.find(f => f.id === fileId);
  if (!file || file.archived) return session;
  return {
    ...session,
    files: session.files.map(f => f.id === fileId ? { ...f, archived: true } : f),
    archivedCount: session.archivedCount + 1,
  };
}

export function takeQueuedInput(
  session: LearningSession,
  inputId?: string,
): { session: LearningSession; input: QueuedInput } | null {
  const queued = session.queued ?? [];
  const index = inputId ? queued.findIndex((input) => input.id === inputId) : 0;
  const input = queued[index];
  if (!input) return null;
  return {
    session: { ...session, queued: queued.filter((_, i) => i !== index) },
    input,
  };
}

// Decisions and failures need attention before another queued question can run.
export function canAdvanceQueue(session: LearningSession | undefined): boolean {
  return (
    !!session &&
    !session.deletedAt &&
    !!session.queued?.length &&
    (session.status === "ready" || session.status === "outside")
  );
}
