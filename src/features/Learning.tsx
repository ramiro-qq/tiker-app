import { availableAgentModels, selectAgentModel } from "../shared/agent/modelPolicy";
import { Fragment, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Sparkles,
  Compass,
  Plus,
  Archive,
  FileText,
  ChevronDown,
  ListOrdered,
  CircleCheck,
  LoaderCircle,
  CircleAlert,
  X,
  Trash2,
  Square,
  ArrowUpToLine,
} from "lucide-react";
import { materialHtml as html } from "./learning/materialHtml";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Trace from "./learning/Trace";
import { applyGenerationEvent, settleDrafts } from "./learning/generation";
import { conversationTrace } from "./learning/conversation";
import { createTrace, updateTrace, finishTrace, type TraceRun, type ProgressEvent } from "../shared/agent/progress";
import { learning } from "../services/learning";
import {
  message,
  newSession,
  enterLearning,
  parseStore,
  previewMaterial,
  takeQueuedInput,
  canAdvanceQueue,
  type MaterialPreview,
  markArchivedFile,
  type LearningSession,
  type LearningStore,
  type Material,
} from "./learning/model";
import { uniqueTitle, type LibraryNode } from "./library/model";
import { SessionRuns } from "../shared/agent/sessionRuns";
import { models, type ModelSettings } from "../services/models";
import { defaultPreferences } from "./learning/preferences";
import "./Learning.css";
import learningBackdrop from "../assets/learning-backdrop.webp";
import ArchiveLocation from "./learning/ArchiveLocation";
import { content } from "../services/content";

const DocumentPreview = lazy(() => import("./editor/DocumentPreview"));

const topics = [
  [
    "AI 工程 · 检索增强",
    "构建可靠的 RAG 知识问答",
    "从文档检索到有依据的回答，理解关键步骤。",
  ],
  [
    "Agent · 工具调用",
    "MCP 如何连接 AI 与工具？",
    "结合一个调用示例，弄懂模型与工具的协作。",
  ],
  [
    "Agent · 上下文工程",
    "如何让 Agent 记住关键信息？",
    "理解上下文窗口、记忆与信息筛选。",
  ],
  [
    "基础原理 · 语义检索",
    "向量数据库如何找到相似内容？",
    "从 Embedding 开始，理解语义相似度。",
  ],
];
const placeholder = "说说想学的知识、已有基础，或遇到的困惑…";
function readLibrary(): LibraryNode[] {
  const raw = JSON.stringify(content.library());
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    !value.every(
      (n) =>
        typeof n.id === "string" &&
        typeof n.title === "string" &&
        Array.isArray(n.tags),
    )
  )
    throw new Error("资料库索引损坏，请先备份并恢复本机数据。");
  return value;
}
function folderPath(nodes: LibraryNode[], id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = id;
  while (current) {
    if (seen.has(current))
      throw new Error("资料库目录结构异常，请重新选择位置。");
    seen.add(current);
    const node = nodes.find((n) => n.id === current && n.kind === "folder");
    if (!node) throw new Error("所选目录已不存在，请重新选择位置。");
    path.unshift(node.title);
    current = node.parentId ?? "";
  }
  return path;
}
function Composer({
  value,
  setValue,
  onSend,
  busy,
  onStop,
  modelId,
  availableModels,
  modelsLoading,
  modelError,
  onSelectModel,
  onRefreshModels,
  home = false,
  inputRef,
}: {
  value: string;
  setValue: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  onStop?: () => void;
  modelId: string | null;
  availableModels: ModelSettings[];
  modelsLoading: boolean;
  modelError: string;
  onSelectModel: (id: string) => void;
  onRefreshModels: () => void;
  home?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form
      className={`tz-composer${home ? " home-composer" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="学习问题"
        placeholder={home ? placeholder : "继续提问，或补充你想了解的细节…"}
        value={value}
        maxLength={4000}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {modelError && <p className="tz-model-error" role="alert">{modelError}</p>}
      <div>
        <span className="tz-send-hint">Ctrl + Enter 发送</span>
        <label className="tz-model-picker">
          <Sparkles className="tz-model-icon" size={14} aria-hidden="true" />
          <select aria-label="探知模型" value={modelId ?? ""}
            title={availableModels.find((model) => model.id === modelId)?.name ?? "请在设置模块中添加自定义模型"}
            disabled={modelsLoading || availableModels.length === 0}
            onFocus={onRefreshModels}
            onChange={(e) => onSelectModel(e.target.value)}>
            {!modelId && <option value="" disabled>{modelsLoading ? "正在读取模型…" : availableModels.length ? "请选择模型" : "暂无自定义模型"}</option>}
            {modelId && !availableModels.some((model) => model.id === modelId) &&
              <option value={modelId} disabled>模型已不可用</option>}
            {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
        {busy && (
          <button
            type="button"
            className="tz-stop"
            aria-label="停止当前任务"
            title="停止当前任务，保留排队问题"
            onClick={onStop}
          >
            <Square size={14} fill="currentColor" />
          </button>
        )}
        {(!busy || !!value.trim()) && <button
          type="submit"
          className="tz-send"
          aria-label={busy ? "加入队列" : "开始探索"}
          title="发送学习问题（Ctrl + Enter）"
          aria-keyshortcuts="Control+Enter"
          disabled={!value.trim() || !availableModels.some((model) => model.id === modelId)}
        >
          <ArrowUp size={18} />
        </button>}
      </div>
    </form>
  );
}
export default function Learning({
  visible,
}: {
  visible: boolean;
  onSettings: () => void;
}) {
  const [storageError, setStorageError] = useState("");
  const libraryScope = useRef(content.getSnapshot().data.libraryId);
  const mounted = useRef(true);
  const [store, setStore] = useState<LearningStore>(() => {
    try {
      return enterLearning(parseStore(JSON.stringify(content.learning())));
    } catch {
      return { sessions: [], activeId: null };
    }
  });
  const current = useRef(store);
  current.current = store;
  const persistedContent = useSyncExternalStore(content.subscribe, content.getSnapshot);
  const lastRemoteGeneration = useRef(persistedContent.remoteGeneration);
  useEffect(() => {
    if (lastRemoteGeneration.current === persistedContent.remoteGeneration) return;
    lastRemoteGeneration.current = persistedContent.remoteGeneration;
    const raw = persistedContent.data.learning;
    const incoming = parseStore(JSON.stringify(raw));
    for (const old of current.current.sessions) {
      const remote = raw.sessions.find(s => s.id === old.id);
      if (JSON.stringify(old) !== JSON.stringify(remote)) running.current.interrupt(old.id);
    }
    incoming.sessions = incoming.sessions.map(session => {
      const old = current.current.sessions.find(s => s.id === session.id);
      const remote = raw.sessions.find(s => s.id === session.id);
      return old && JSON.stringify(old) === JSON.stringify(remote) ? old : session;
    });
    const activeId = incoming.sessions.some(s => s.id === current.current.activeId) ? current.current.activeId : null;
    current.current = { ...incoming, activeId };
    setStore(current.current);
  }, [persistedContent.remoteGeneration]);
  const unreadable = useRef(false);
  const [traces, setTraces] = useState<Record<string, TraceRun[]>>({});
  const [input, setInput] = useState("");
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [availableModels, setAvailableModels] = useState<ModelSettings[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState("");
  const effectiveModelId =
    selectAgentModel(availableModels, preferences.modelId);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = { modelId: effectiveModelId };
  async function refreshModels() {
    try {
      const config = await models.load();
      setAvailableModels(availableAgentModels(config.models));
      setModelError("");
    } catch { setModelError("模型列表读取失败，请重试。"); }
    finally { setModelsLoading(false); }
  }
  useEffect(() => {
    if (visible) void refreshModels();
  }, [visible]);
  function selectModel(id: string) {
    if (!availableModels.some((model) => model.id === id)) return;
    setPreferences({ modelId: id });
    setModelError("");
  }
  const modelPickerProps = {
    modelId: effectiveModelId, availableModels, modelsLoading, modelError,
    onSelectModel: selectModel, onRefreshModels: () => { void refreshModels(); },
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [conversationWidth, setConversationWidth] = useState(620);
  const conversationRef = useRef<HTMLElement>(null);
  const conversationMaxWidth = () => {
    const workbench = conversationRef.current?.parentElement;
    if (!workbench) return 620;
    const style = getComputedStyle(workbench);
    return Math.max(360, workbench.clientWidth
      - parseFloat(style.getPropertyValue('--tz-history-width'))
      - parseFloat(style.getPropertyValue('--tz-preview-min-width')));
  };
  const resizeStart = useRef<{x: number; width: number} | null>(null);
  const [preview, setPreview] = useState<MaterialPreview | null>(null);
  const [feedback, setFeedback] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const documentRef = useRef<HTMLElement>(null);
  const readingPositions = useRef(new Map<string, number>());
  const running = useRef(new SessionRuns());
  useEffect(() => {
    const runs = running.current;
    mounted.current = true;
    return () => { mounted.current = false; runs.interruptAll(); };
  }, []);
  const [deletedSession, setDeletedSession] = useState<string | null>(null);
  const [archiveFile, setArchiveFile] = useState<Material | null>(null);
  const [archiveSession, setArchiveSession] = useState("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [folders, setFolders] = useState<LibraryNode[]>([]);
  const [archiveState, setArchiveState] = useState<
    "edit" | "saving" | "success" | "error"
  >("edit");
  const [archiveError, setArchiveError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const archiveBusy = useRef(false);
  const archiveDrafts = useRef(new Map<string, {title: string; target: string}>());
  const active = store.sessions.find(
    (s) => s.id === store.activeId && !s.deletedAt,
  );
  const selected = previewMaterial(active, preview);
  const busy =
    !!active &&
    (running.current.has(active.id) ||
      active.status === "classifying" ||
      active.status === "research");
  function closePreview() {
    if (selected && documentRef.current) readingPositions.current.set(selected.id, documentRef.current.scrollTop);
    const fileId = preview?.fileId;
    setPreview(null);
    requestAnimationFrame(() => {
      const card = Array.from(
        messagesRef.current?.querySelectorAll<HTMLButtonElement>(
          ".tz-card-preview",
        ) ?? [],
      ).find((button) => button.dataset.fileId === fileId);
      (card ?? messagesRef.current?.querySelector<HTMLButtonElement>(".tz-card-preview") ?? inputRef.current)?.focus();
    });
  }
  function openMaterial(fileId: string) {
    if (!active?.files.some((file) => file.id === fileId)) return;
    if (selected && documentRef.current) readingPositions.current.set(selected.id, documentRef.current.scrollTop);
    setPreview({ sessionId: active.id, fileId });
    patch(active.id, (session) => ({ ...session, selectedId: fileId }));
  }
  useEffect(() => {
    if (selected && documentRef.current) documentRef.current.scrollTop = readingPositions.current.get(selected.id) ?? 0;
  }, [selected?.id]);
  function commit(next: LearningStore) {
    if (!mounted.current || content.getSnapshot().data.libraryId !== libraryScope.current) throw new Error('资料库已切换，原操作已停止。');
    if (unreadable.current)
      throw new Error("学习记录无法读取，请先恢复本机记录。");
    content.saveLearning(next);
    current.current = next;
    setStore(next);
    setStorageError("");
  }
  function patch(id: string, change: (s: LearningSession) => LearningSession) {
    const next = {
      ...current.current,
      sessions: current.current.sessions.map((s) =>
        s.id === id ? { ...change(s), updatedAt: Date.now() } : s,
      ),
    };
    try {
      commit(next);
    } catch {
      current.current = next;
      setStore(next);
      setStorageError(
        "本机存储写入失败，当前学习内容尚未保存。请释放空间后点击重试保存。",
      );
    }
  }
  useEffect(() => {
    setPreview(null);
    try {
      const next = enterLearning(parseStore(JSON.stringify(content.learning())));
      unreadable.current = false;
      current.current = next;
      setStore(next);
    } catch (e) {
      unreadable.current = true;
      setStorageError(String(e));
    }
  }, []);
  useEffect(() => {
    if (!visible) return;
    const next = enterLearning(current.current);
    current.current = next;
    setStore(next);
    const session = next.sessions.find(s => s.id === next.activeId);
    const fileId = session?.files.find(file => file.id === session.selectedId)?.id ?? session?.files[0]?.id;
    setPreview(session && fileId ? { sessionId: session.id, fileId } : null);
  }, [visible]);
  useEffect(() => {
    if (visible && followMessages.current)
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [
    active?.id,
    active?.messages,
    traces,
    active?.status,
    active?.stage,
    active?.files.length,
    visible,
  ]);
  useEffect(() => {
    if (archiveFile && !archiveDialog.current?.open) {
      archiveDialog.current?.showModal();
      archiveDialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [archiveFile]);
  useEffect(() => {
    if (archiveState === "success")
      archiveDialog.current
        ?.querySelector<HTMLButtonElement>("footer button")
        ?.focus();
  }, [archiveState]);
  function newLearning() {
    start("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function stopTask(id: string) {
    setTraces(previous => ({ ...previous, [id]: (previous[id] ?? []).map(run => finishTrace(run, "stopped")) }));
    running.current.interrupt(id);
    patch(id, (session) => ({
      ...settleDrafts(session, "stopped"),
      status: session.messages.length ? "ready" : "idle",
      error: "",
      messages: [...session.messages, message("assistant", "已停止本轮生成。")],
    }));
  }
  function deleteSession(id: string) {
    const sessions = current.current.sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            deletedAt: Date.now(),
            status:
              session.status === "classifying" || session.status === "research"
                ? session.messages.length
                  ? "ready"
                  : "idle"
                : session.status,
          }
        : session,
    );
    let activeId = current.current.activeId;
    if (activeId === id) {
      const next =
        sessions.find((session) => !session.deletedAt) ?? newSession("");
      if (!sessions.includes(next)) sessions.unshift(next);
      activeId = next.id;
    }
    try {
      commit({ sessions, activeId });
      running.current.interrupt(id);
      setDeletedSession(id);
      if (store.activeId === id) {
        setPreview(null);
        setInput("");
      }
    } catch {
      setStorageError("删除未能保存，请重试。会话内容仍保留。");
    }
  }
  function undoDelete() {
    if (!deletedSession) return;
    try {
      commit({
        ...current.current,
        sessions: current.current.sessions.map((session) =>
          session.id === deletedSession
            ? { ...session, deletedAt: undefined }
            : session,
        ),
      });
      setDeletedSession(null);
    } catch {
      setStorageError("恢复会话未能保存，请重试。");
    }
  }
  function dispatchQueued(id: string, inputId?: string, interrupt = false) {
    if (!availableModels.some(model => model.id === preferencesRef.current.modelId)) {
      setModelError("请选择可用的自定义模型。");
      return;
    }
    const session = current.current.sessions.find(
      (s) => s.id === id && !s.deletedAt,
    );
    if (!session || (running.current.has(id) && !interrupt)) return;
    const next = takeQueuedInput(session, inputId);
    if (!next) return;
    if (interrupt) stopTask(id);
    patch(id, (s) => ({
      ...s,
      queued: next.session.queued,
      messages: [...s.messages, message("user", next.input.text)],
    }));
    void run(id, next.input.text);
  }
  async function run(id: string, text: string) {
    const runLibraryId = content.getSnapshot().data.libraryId;
    const sessionContext = current.current.sessions.find(s => s.id === id);
    const options = { ...preferencesRef.current, sourceUrls: sessionContext?.sourceUrls ?? [...new Set(sessionContext?.sources.flatMap(source => source.originUrl ? [source.originUrl] : []) ?? [])].slice(0, 3) };
    if (!options.modelId) {
      setModelError("请先选择自定义模型。");
      return;
    }
    const signal = running.current.begin(id);
    if (!signal) return;
    const traceId = crypto.randomUUID();
    const anchorId = current.current.sessions.find(s => s.id === id)?.messages.filter(m => m.role === 'user').slice(-1)[0]?.id ?? '';
    setTraces(previous => ({ ...previous, [id]: [...(previous[id] ?? []), createTrace(traceId, anchorId)].slice(-12) }));
    const responseId = crypto.randomUUID();
    const onProgress = (event: ProgressEvent) => {
      if (!mounted.current || signal.aborted || !running.current.isCurrent(id, signal) || content.getSnapshot().data.libraryId !== runLibraryId) return;
      setTraces(previous => ({ ...previous, [id]: (previous[id] ?? []).map(run => run.id === traceId ? updateTrace(run, event) : run) }));
      if (event.kind === 'material' || event.kind === 'response') {
        patch(id, session => applyGenerationEvent(session, event, responseId));
        const session = current.current.sessions.find(session => session.id === id);
        if (event.kind === 'material' && session?.files.length && current.current.activeId === id) {
          setPreview(previous => previous?.sessionId === id ? previous : {sessionId:id,fileId:session.files[0].id});
        }
      }
    };
    let outcome: TraceRun['state'] = 'done';
    const check = () => {
      signal.throwIfAborted();
      if (
        content.getSnapshot().data.libraryId !== runLibraryId ||
        !running.current.isCurrent(id, signal) ||
        !current.current.sessions.some((s) => s.id === id && !s.deletedAt)
      )
        throw new DOMException("本轮已停止", "AbortError");
    };
    const update = (change: (s: LearningSession) => LearningSession) => {
      check();
      patch(id, change);
    };
    update((s) => ({
      ...s,
      status: "classifying",
      pending: text,
      error: "",
    }));
    try {
      let snapshot = current.current.sessions.find((s) => s.id === id)!;
      const intent = await learning.intent(
        text,
        snapshot.files.length || snapshot.archivedCount ? snapshot.title : "",
        snapshot.messages.slice(-16),
        signal,
        options,
        onProgress,
      );
      check();
      update(s => ({ ...s, sourceUrls: intent.seedUrls }));
      options.sourceUrls = intent.seedUrls;
      if (intent.kind !== "learning") {
        update((s) => ({
          ...s,
          title:
            s.files.length || s.archivedCount
              ? s.title
              : intent.title || s.title,
          status:
            intent.kind === "new_topic"
              ? "topic"
              : intent.kind === "clarify"
                ? "clarify"
                : "outside",
          pending: text,
          pendingTitle: intent.title,
          messages: [
            ...s.messages,
            message(
              "assistant",
              intent.kind === "outside"
                ? "我可以帮你理解知识、研究资料和整理学习笔记，暂不提供预订、发送或业务代办服务。\n如果想学习某个原理或方法，可以告诉我你想弄懂什么。"
                : intent.kind === "new_topic"
                  ? `这是一个新的学习主题。建议单独创建学习任务，当前 ${s.title.split("：")[0]} 材料会保留。`
                  : intent.reply ||
                    "你希望重点学习哪个知识点？也可以补充已有基础和想解决的问题。",
            ),
          ],
        }));
        return;
      }
      update((s) => ({
        ...s,
        title:
          s.files.length || s.archivedCount ? s.title : intent.title || s.title,
        status: "research",
        stage: 0,
        messages: [
          ...s.messages,
          message(
            "assistant",
            intent.reply ||
              "我会先梳理学习目标，检索相关资料，再整理概念、案例与练习。",
          ),
        ],
      }));
      // Keep the process mounted at its question so manual disclosure survives new progress.
      const intro = current.current.sessions.find(s => s.id === id)?.messages.slice(-1)[0];
      if (intro) setTraces(previous => ({ ...previous, [id]: (previous[id] ?? []).map(run => run.id === traceId ? { ...run, summaryMessageId: intro.id } : run) }));
      update((s) => ({ ...s, stage: 1 }));
      const research = await learning.research(
        intent.query || intent.title || text,
        intent.seedUrls,
        snapshot.messages.slice(-16),
        signal,
        options,
        onProgress,
      );
      check();
      update((s) => ({ ...s, stage: 2, sources: research.sources }));
      snapshot = current.current.sessions.find((s) => s.id === id)!;
      const generated = await learning.generate(
        snapshot.title,
        snapshot.messages.slice(-16),
        research.sources,
        snapshot.files,
        research.warning,
        research.plan,
        signal,
        options,
        onProgress,
      );
      check();
      update((s) => {
        const files = generated.files.map((file) => ({
          ...file,
          status: "ready" as const,
          id:
            s.files.find(
              (old) => old.name === file.name,
            )?.id ?? crypto.randomUUID(),
        }));
        const selectedName = s.files.find((f) => f.id === s.selectedId)?.name;
        return {
          ...s,
          status: "ready",
          files,
          selectedId: files.find((f) => f.name === selectedName)?.id ?? null,
          messages: s.messages.some(m => m.id === responseId)
            ? s.messages.map(m => m.id === responseId ? {...m,text:generated.reply} : m)
            : [...s.messages, {...message("assistant", generated.reply),id:responseId}],
          error: "",
        };
      });
      const completed = current.current.sessions.find(s => s.id === id);
      if (current.current.activeId === id && completed?.files.length) {
        setPreview({sessionId: id, fileId: completed.selectedId ?? completed.files[0].id});
      }
    } catch (error) {
      outcome = "error";
      if (signal.aborted || !running.current.isCurrent(id, signal)) return;
      update((s) => ({
        ...s,
        status: "error",
        error: String(error instanceof Error ? error.message : error),
      }));
    } finally {
      if (mounted.current) {
        if (outcome === 'error' && running.current.isCurrent(id, signal)) patch(id, session => settleDrafts(session, 'error'));
        setTraces(previous => ({ ...previous, [id]: (previous[id] ?? []).map(run => run.id === traceId ? finishTrace(run, signal.aborted ? "stopped" : outcome) : run) }));
      }
      if (running.current.finish(id, signal)) {
        setStore({ ...current.current });
        const session = current.current.sessions.find(
          (s) => s.id === id && !s.deletedAt,
        );
        if (canAdvanceQueue(session)) dispatchQueued(id);
      }
    }
  }
  function start(text: string) {
    if (storageError) return;
    const s = newSession(text);
    try {
      commit({ sessions: [s, ...current.current.sessions], activeId: s.id });
      setInput("");
      setPreview(null);
      if (text.trim()) void run(s.id, text);
    } catch {
      setStorageError("无法创建学习记录，请释放本机空间后重试。");
    }
  }
  function send() {
    const text = input.trim();
    if (!text || storageError) return;
    if (!availableModels.some((model) => model.id === effectiveModelId)) {
      setModelError("请选择可用的自定义模型；模型需先在设置模块中添加。");
      return;
    }
    if (!active) {
      start(text);
      return;
    }
    if (busy) {
      patch(active.id, (s) => ({
        ...s,
        queued: [...(s.queued ?? []), { id: crypto.randomUUID(), text }],
      }));
      setInput("");
      return;
    }
    patch(active.id, (s) => ({
      ...s,
      title: s.messages.length ? s.title : text.slice(0, 28),
      messages: [...s.messages, message("user", text)],
    }));
    setInput("");
    void run(active.id, text);
  }
  function selectSession(id: string) {
    try {
      commit({ ...current.current, activeId: id });
      setInput("");
      setFeedback("");
      const session = current.current.sessions.find(s => s.id === id);
      const fileId = session?.selectedId ?? session?.files[0]?.id;
      setPreview(fileId ? {sessionId: id, fileId} : null);
    } catch {
      setStorageError("切换会话状态未能保存，请重试。");
    }
  }
  function beginArchive(file: Material, trigger: HTMLButtonElement) {
    if (!active || busy || (file.status && file.status !== "ready")) return;
    archiveTrigger.current = trigger;
    setArchiveFile({ ...file });
    setArchiveSession(active.id);
    const draft = archiveDrafts.current.get(file.id);
    setTitle(draft?.title ?? file.title);
    setArchiveState("edit");
    setArchiveError("");
    setSavedPath("");
    try {
      const nodes = readLibrary();
      setFolders(nodes);
      setTarget(draft?.target && nodes.some(n => n.id === draft.target && n.kind === "folder") ? draft.target : "");
    } catch (e) {
      setArchiveError(String(e));
    }
  }
  function closeArchive() {
    if (archiveBusy.current) return;
    if (archiveFile && archiveState !== "success") archiveDrafts.current.set(archiveFile.id, {title, target});
    archiveDialog.current?.close();
    setArchiveFile(null);
    requestAnimationFrame(() =>
      (archiveTrigger.current ?? inputRef.current)?.focus(),
    );
  }
  async function submitArchive(event: FormEvent) {
    event.preventDefault();
    if (!archiveFile || archiveBusy.current) return;
    if (!title.trim()) {
      setArchiveError("请输入材料标题。");
      archiveDialog.current?.querySelector("input")?.focus();
      return;
    }
    if (!target) { setArchiveError("请选择归档目录。"); return; }
    if (/[\\/:*?"<>|\x00-\x1f]/.test(title)) {
      setArchiveError("标题不能包含 /、\\ 等文件路径字符。");
      return;
    }
    archiveBusy.current = true;
    setArchiveState("saving");
    setArchiveError("");
    try {
      // Preflight local storage before creating a real file. Index uses the stable draft ID on retry.
      const nodes = readLibrary();
      const path = folderPath(nodes, target);
      content.saveLearning(current.current);
      await content.flush();
      const saved = await learning.archive(
            archiveFile.id,
            title.trim(),
            path,
            archiveFile.markdown,
          );
      if (!mounted.current || content.getSnapshot().data.libraryId !== libraryScope.current) throw new Error('资料库已切换，归档结果保留在原资料库，请切回后查看。');
      {
        const latest = readLibrary();
        folderPath(latest, target);
        const id = `learning-${archiveFile.id}`;
        if (!latest.some((n) => n.id === id)) {
          const fileTitle =
            saved.split(/[\\/]/).pop()?.replace(/\.md$/, "") || title.trim();
          const node: LibraryNode = {
            id,
            parentId: target || null,
            kind: "doc",
            title: uniqueTitle(latest, target || null, fileTitle),
            content: html(archiveFile.markdown),
            tags: [],
            favorite: false,
            updatedAt: Date.now(),
            visitedAt: Date.now(),
            markdown: archiveFile.markdown,
            sourcePath: saved,
          };
          content.saveLibrary([...latest, node]);
          await content.flush();
          if (!mounted.current || content.getSnapshot().data.libraryId !== libraryScope.current) throw new Error('资料库已切换，已停止更新会话。');
          window.dispatchEvent(new Event("tiker:library-changed"));
        }
      }
      commit({
        ...current.current,
        sessions: current.current.sessions.map((s) =>
          s.id === archiveSession ? markArchivedFile(s, archiveFile.id) : s,
        ),
      });
      archiveDrafts.current.delete(archiveFile.id);
      setSavedPath(saved);
      setArchiveState("success");
    } catch (error) {
      setArchiveError(
        `${String(error instanceof Error ? error.message : error)} 草稿和输入已保留，可修正后重试。`,
      );
      setArchiveState("error");
    } finally {
      archiveBusy.current = false;
    }
  }
  const recent = store.sessions.filter((session) => !session.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const decision =
    !!active && ["clarify", "outside", "topic"].includes(active.status);
  return (
    <section className="tz-root" hidden={!visible} aria-label="探知">
      {storageError && (
        <div className="tz-storage-error" role="alert">
          {storageError}
          <button
            onClick={() => {
              try {
                if (unreadable.current) {
                  const restored = parseStore(
                    JSON.stringify(content.learning()),
                  );
                  unreadable.current = false;
                  current.current = restored;
                  setStore(restored);
                  setStorageError("");
                } else commit(current.current);
              } catch {
                setStorageError(
                  "本机学习记录仍无法读写，请恢复记录或释放空间后重试。",
                );
              }
            }}
          >
            重试保存
          </button>
        </div>
      )}
      {deletedSession && (
        <div className="tz-delete-feedback" role="status">
          已删除会话<button onClick={undoDelete}>撤销</button>
          <button
            aria-label="关闭删除提示"
            onClick={() => setDeletedSession(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!active ? (
        <main className="tz-home">
          <img className="tz-home-backdrop" src={learningBackdrop} alt="" aria-hidden="true" />
          <div className="tz-home-guide">
            <div className="tz-badge">
              <Sparkles size={26} />
            </div>
            <h1>从好奇出发，把知识弄懂。</h1>
            <Composer
              home
              value={input}
              setValue={setInput}
              onSend={send}
              busy={false}
              {...modelPickerProps}
              inputRef={inputRef}
            />
            <p className="tz-recommend-label"><Compass size={16} aria-hidden="true" />想不想看看？</p>
            <div className="tz-topics">
              {topics.map(([field, title, detail]) => (
                <button
                  key={title}
                  onClick={() => start(`我想学习${title}，${detail}`)}
                >
                  <small>{field}</small>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <button
                className="tz-resume"
                onClick={() => selectSession(recent[0].id)}
              >
                继续上次学习：{recent[0].title}
              </button>
            )}
          </div>
        </main>
      ) : (
        <div className={`tz-workbench${selected ? " has-preview" : ""}`} style={{ "--tz-chat-width": `${conversationWidth}px` } as CSSProperties}>
          <aside className="tz-history">
            <button className="tz-primary tz-new" onClick={newLearning}>
              <Plus size={15} />
              开始新的学习
            </button>
            <div className="tz-history-list">
              {recent.map((s, i) => {
                const date = new Date(s.updatedAt).toLocaleDateString("zh-CN");
                const prev = recent[i - 1];
                const group =
                  !prev ||
                  new Date(prev.updatedAt).toLocaleDateString("zh-CN") !== date;
                return (
                  <div key={s.id}>
                    {group && (
                      <p className="tz-date">
                        {date === new Date().toLocaleDateString("zh-CN")
                          ? "今天"
                          : date.replace(/(\d+)\/(\d+)\/(\d+)/, (_, y, m, d) => `${y}/${m.padStart(2, "0")}/${d.padStart(2, "0")}`)}
                      </p>
                    )}
                    <div
                      className={`tz-history-row${s.id === active.id ? " selected" : ""}`}
                    >
                      <button
                        className="tz-history-item"
                        title={s.title}
                        onClick={() => selectSession(s.id)}
                      >
                        <span>{s.title}</span>
                      </button>
                      <button
                        className="tz-delete-session"
                        aria-label={`删除会话：${s.title}`}
                        title="删除会话"
                        onClick={() => deleteSession(s.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
          <section
            className={`tz-conversation${decision ? ` tz-decision tz-${active.status}` : ""}`}
            ref={conversationRef}
            aria-label="学习对话"
          >
            <div className="tz-messages" ref={messagesRef} onScroll={event => {
              const list = event.currentTarget;
              followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
              setAwayFromLatest(!followMessages.current);
            }}>
              {active.messages.length === 0 && active.status === "idle" && (
                <div className="tz-empty-conversation">
                  <Sparkles size={28} />
                  <h2>这次想弄懂什么？</h2>
                  <p>说说想学的知识、已有基础，或遇到的困惑。</p>
                </div>
              )}
              {active.messages.map((m, i) => {
                const process = conversationTrace(active.messages, traces[active.id] ?? [], m.id);
                const processFiles = process.run?.state === 'done' && !(traces[active.id] ?? []).some(run => run.startedAt > process.run!.startedAt) ? active.files : [];
                return <Fragment key={m.id}>
                {!(process.run && m.role === 'assistant') && !(traces[active.id] ?? []).some(run => run.summaryMessageId === m.id) && <div
                  className={`tz-message ${m.role}${decision && i >= active.messages.length - 2 ? " tz-decision-message" : ""}`}
                >
                  {m.role === "assistant" &&
                    !(decision && i >= active.messages.length - 2) && (
                      <span className="tz-avatar">
                        <Bot size={15} />
                      </span>
                    )}
                  <div className="tz-message-body">
                    {m.role === "assistant" &&
                      decision &&
                      i >= active.messages.length - 2 &&
                      active.status !== "topic" && (
                        <span className="tz-decision-signature">
                          <Sparkles size={13} />
                          探知
                        </span>
                      )}
                    <div className="tz-message-text">
                      {m.role === "assistant" &&
                        decision &&
                        i >= active.messages.length - 2 &&
                        active.status === "topic" && (
                          <Sparkles className="tz-inline-sparkles" size={13} />
                        )}
                      {m.text}
                    </div>

                  </div>
                </div>}
                {process.run && <Trace key={process.run.id} run={process.run} summary={process.summary} hasResponse={process.hasResponse} files={processFiles} />}
                </Fragment>;
              })}
              {active.files.length > 0 && <div className="tz-document-cards" aria-label="会话文档">
                {active.files.map(file => <div className="tz-document-card" key={file.id}>
                  <button className="tz-card-preview" data-file-id={file.id} onClick={() => openMaterial(file.id)} title={file.title} aria-controls="tz-material-panel">
                    <FileText size={15} /><span>{file.title}</span>
                  </button>
                  <button className="tz-card-archive" aria-label={`归档：${file.title}`} title={file.archived ? "已归档到文档资料库" : "归档到文档资料库"} disabled={busy || (!!file.status && file.status !== 'ready')} onClick={event => beginArchive(file, event.currentTarget)}><Archive size={12} /></button>
                  <button className="tz-card-open" aria-label={`预览：${file.title}`} onClick={() => openMaterial(file.id)}><ArrowUpRight size={15} /></button>
                </div>)}
              </div>}

              {busy && !(traces[active.id]?.length) && <Trace run={{
                id: active.id, anchorId: '', startedAt: active.updatedAt, state: 'running',
                steps: [{ id: 'resume', label: active.stage >= 2 ? '编写渐进式学习材料' : '研究学习资料',
                  detail: active.sources.length ? `已读取 ${active.sources.length} 份参考资料。` : '正在等待当前任务状态。', state: 'running', startedAt: active.updatedAt, updatedAt: active.updatedAt }],
              }} />}
              {active.status === "clarify" && (
                <div className="tz-intent-actions">
                  <button className="tz-primary" disabled={busy}
                    onClick={() => inputRef.current?.focus()}>
                    补充学习目标
                  </button>
                </div>
              )}
              {active.status === "outside" && <div className="tz-intent-actions"><button className="tz-secondary" onClick={()=>{setInput('');inputRef.current?.focus();}}>换个知识问题</button></div>}
              {active.status === "topic" && (
                <>
                  <div className="tz-intent-actions">
                    <button
                      className="tz-primary"
                      onClick={() => start(active.pending)}
                    >
                      新建「{active.pendingTitle || active.pending.slice(0, 20)}
                      」学习
                    </button>
                    <button
                      className="tz-secondary"
                      onClick={() => {
                        patch(active.id, (s) => ({ ...s, status: "ready" }));
                        dispatchQueued(active.id);
                        inputRef.current?.focus();
                      }}
                    >
                      继续学习 {active.title.split("：")[0]}
                    </button>
                  </div>
                  <p className="tz-boundary">
                    我可以继续解释 {active.title.split("：")[0]}
                    、补充案例和教学代码。预订、发送或修改业务项目等代办请求不会执行，当前学习材料会为你保留。
                  </p>
                </>
              )}
              {active.error && (
                <div className="tz-error" role="alert">
                  <CircleAlert size={16} />
                  <p>{active.error}</p>
                  <button
                    disabled={busy}
                    onClick={() => void run(active.id, active.pending)}
                  >
                    重试
                  </button>
                </div>
              )}
              {feedback && (
                <p role="status" className="tz-feedback">
                  {feedback}
                </p>
              )}
            </div>
            {!!active.queued?.length && (
              <section className="tz-input-queue" aria-label="排队问题">
                <p className="tz-queue-heading"><ListOrdered size={13} />待发送 · {active.queued.length}</p>
                {active.queued.map((item, index) => (
                  <div className="tz-queued-input" key={item.id}>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    <span title={item.text}>{item.text}</span>
                    <button
                      onClick={() => dispatchQueued(active.id, item.id, true)}
                      aria-label={`立即插入：${item.text}`}
                      title="中断当前并立即执行"
                    >
                      <ArrowUpToLine size={15} />
                    </button>
                    <button
                      className="tz-remove-queued"
                      aria-label={`移除排队问题：${item.text}`}
                      title="删除"
                      onClick={() =>
                        patch(active.id, (s) => ({
                          ...s,
                          queued: s.queued?.filter((q) => q.id !== item.id),
                        }))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </section>
            )}
            {awayFromLatest && <button className="tz-latest" onClick={() => { followMessages.current = true; setAwayFromLatest(false); messagesRef.current?.scrollTo({top:messagesRef.current.scrollHeight}); }}>回到最新 ↓</button>}
            <Composer
              value={input}
              setValue={setInput}
              onSend={send}
              busy={busy}
              {...modelPickerProps}
              onStop={() => stopTask(active.id)}
              inputRef={inputRef}
            />
            {selected && <div className="tz-conversation-resizer" role="separator" aria-label="调整对话区域宽度" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={conversationMaxWidth()} aria-valuenow={Math.round(conversationRef.current?.getBoundingClientRect().width ?? conversationWidth)} tabIndex={0}
              onPointerDown={event => {
                if (event.button !== 0) return;
                resizeStart.current = { x: event.clientX, width: conversationRef.current?.getBoundingClientRect().width ?? conversationWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              onPointerMove={event => {
                if (!resizeStart.current) return;
                const max = conversationMaxWidth();
                setConversationWidth(Math.max(360, Math.min(max, resizeStart.current.width + event.clientX - resizeStart.current.x)));
              }}
              onPointerUp={event => { resizeStart.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
              onLostPointerCapture={() => { resizeStart.current = null; }}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const max = conversationMaxWidth();
                const width = conversationRef.current?.getBoundingClientRect().width ?? conversationWidth;
                setConversationWidth(event.key === 'Home' ? 360 : event.key === 'End' ? max : Math.max(360, Math.min(max, width + (event.key === 'ArrowRight' ? 20 : -20))));
              }} />}
          </section>
          {selected && (
            <section
              id="tz-material-panel"
              className="tz-materials"
              aria-label="学习材料"
            >
              <button className="tz-close-preview tz-reader-close" aria-label="关闭材料预览" title="关闭预览，继续对话" onClick={closePreview}><X size={18} /></button>
              <div className="tz-material-workspace">
                <>
                  <article
                    ref={documentRef}
                    className={`tz-document${selected.name.includes("实践") ? " tz-practice" : ""}`}
                    key={selected.id}
                    onClick={(e) => {
                      const link = (e.target as HTMLElement).closest("a");
                      if (!link) return;
                      e.preventDefault();
                      const url = link.getAttribute("href") || "";
                      if (/^https?:\/\//.test(url)) {
                        if (isTauri())
                          void openUrl(url).catch(() =>
                            setFeedback("无法打开来源链接，请检查系统浏览器。"),
                          );
                        else window.open(url, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    <h1 className="te-document-title">{selected.title}</h1>
                    {selected.status && selected.status !== 'ready' && <p className="tz-draft-status" role="status">{selected.status === 'generating' ? '正在生成 · 内容持续更新，尚未完成校验' : selected.status === 'stopped' ? '生成已停止 · 以下为未完成草稿' : '生成未完成 · 以下内容未通过交付校验'}</p>}
                    <Suspense fallback={<p role="status">正在加载文档…</p>}>
                      <DocumentPreview html={html(selected.markdown.replace(/^# .+(?:\r?\n|$)/, ""))} />
                    </Suspense>
                  </article>

                </>
              </div>
            </section>
          )}
        </div>
      )}
      <dialog
        ref={archiveDialog}
        className="tz-archive-dialog"
        aria-labelledby="tz-archive-title"
        onCancel={(e) => {
          e.preventDefault();
          closeArchive();
        }}
      >
        <form onSubmit={submitArchive}>
          <header className="tz-archive-heading"><h2 id="tz-archive-title">
            {archiveState === "success" ? "已归档" : "材料归档"}
          </h2><button type="button" className="tz-close-preview" aria-label="关闭材料归档" disabled={archiveState === "saving"} onClick={closeArchive}><X size={18} /></button></header>
          {archiveState === "success" ? (
            <div className="tz-archive-success" role="status">
              <CircleCheck size={30} />
              <p>材料已保存到资料库，对应临时草稿已移除。</p>
              <small>{savedPath}</small>
            </div>
          ) : (
            <>
              <label>
                标题
                <input
                  value={title}
                  disabled={archiveState === "saving"}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  autoFocus
                  aria-invalid={!!archiveError && !title.trim()}
                />
              </label>
              <ArchiveLocation nodes={folders} value={target} disabled={archiveState === "saving"} onChange={setTarget} onCreate={(node) => {
                const next = [...folders, node];
                content.saveLibrary(next);
                setFolders(next);
                setTarget(node.id);
              }} />
              {archiveError && (
                <p className="tz-archive-error" role="alert">
                  {archiveError}
                </p>
              )}
            </>
          )}
          <footer>
            {archiveState === "success" ? (
              <button
                type="button"
                className="tz-primary"
                onClick={closeArchive}
              >
                完成
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="tz-secondary"
                  disabled={archiveState === "saving"}
                  onClick={closeArchive}
                >
                  取消
                </button>
                <button
                  className="tz-primary"
                  type="submit"
                  disabled={archiveState === "saving" || !target}
                >
                  {archiveState === "saving" && (
                    <LoaderCircle className="tz-spin" size={15} />
                  )}{" "}
                  {archiveState === "saving"
                    ? "归档中…"
                    : archiveState === "error"
                      ? "重试归档"
                      : "确认"}
                </button>
              </>
            )}
          </footer>
        </form>
      </dialog>
    </section>
  );
}
