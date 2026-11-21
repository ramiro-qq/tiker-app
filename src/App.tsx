import { flushSync } from "react-dom";
import { useDialogKeyboard } from "./hooks/useDialogKeyboard";
import Navigation from "./components/Navigation";
import type { GithubStatus } from "./services/github";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadSyncSettings, saveSyncDelay, type SyncSettings as SyncConfig } from "./config/syncConfig";
import { queueConfigSave, type AppConfig } from "./config/appConfig";
import Clips from "./features/Clips";
import Library from "./features/Library";
import Plugins from "./features/Plugins";
import { subscribeToClips, type ClipRequest } from "./services/browserClipper";
const Settings = lazy(() => import("./features/Settings"));

import { type ReaderState } from "./features/Reader";
import brandMark from "./assets/brand-mark.svg";
import "./App.css";
import { sync } from "./services/sync";
import { content, initializeContent, refreshContent } from "./services/content";
import { applyFontSize, type FontSizeMode } from "./config/typography";

const SearchView = lazy(() => import("./features/search/SearchView"));
const Learning = lazy(() => import("./features/Learning"));
type View = "search" | "explore" | "bookmarks" | "plugins" | "library" | "reader" | "clips" | "settings";
function Welcome({ onEnter }: { onEnter: () => void }) {
  return <div className="welcome"><div className="welcome-panel"><img src={brandMark} width="64" height="64" alt="Tiker" /><h2>Tiker</h2><p>本地资料管理 · Git 版本 · 标签 · 网页剪藏</p><button className="primary-button" onClick={onEnter}>新建 / 打开资料库…</button><small>选择一个文件夹作为资料库；空文件夹会自动初始化分类结构与 Git 仓库。<br />保存后的版本可按设置自动记录，也可随时手动提交。</small></div></div>;
}
function App({ initialConfig, initialConfigError, initialSyncSettings, initialSyncError }: { initialConfig: AppConfig; initialConfigError: string; initialSyncSettings: SyncConfig; initialSyncError: string }) {
  useDialogKeyboard();
  const [config, setConfig] = useState(initialConfig);
  const configRef = useRef(initialConfig);
  const [syncConfig, setSyncConfig] = useState(initialSyncSettings);
  const [syncError, setSyncError] = useState(initialSyncError);
  const retrySyncConfig = async () => {
    try { setSyncConfig(await loadSyncSettings()); setSyncError(""); }
    catch (error) { setSyncError(`同步配置加载失败：${String(error)}`); }
  };
  const changeSyncDelay = async (seconds: number) => {
    try {
      const saved = await saveSyncDelay(seconds);
      // A queued delay response must not replace a more recent authorization result.
      setSyncConfig(current => ({ ...current, autoSyncDelaySeconds: saved.autoSyncDelaySeconds }));
      setSyncError("");
    } catch (error) { setSyncError(`同步设置未保存：${String(error)}`); }
  };
  const [configError, setConfigError] = useState(initialConfigError);
  const [saving, setSaving] = useState(false);
  const persistence = useSyncExternalStore(content.subscribe, content.getSnapshot);
  const [contentError, setContentError] = useState('');
  const syncEnabling = useRef(false);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  useEffect(() => {
    const failed = (event: Event) => setContentError((event as CustomEvent<string>).detail);
    window.addEventListener('tiker:content-error', failed);
    return () => window.removeEventListener('tiker:content-error', failed);
  }, []);
  const saveRevision = useRef(0);
  const updateConfig = async (change: (current: AppConfig) => AppConfig) => {
    if (initialConfigError) { setConfigError(initialConfigError); return; }
    const next = change(configRef.current);
    if (next.workspace.currentPath !== configRef.current.workspace.currentPath) {
      const previous = configRef.current;
      flushSync(() => setWorkspaceSwitching(true));
      try {
        await content.flush();
        await queueConfigSave(next);
        await initializeContent();
        configRef.current = next;
        setConfig(next);
        setWorkspaceEpoch(value => value + 1);
        setConfigError('');
      } catch (error) {
        try { await queueConfigSave(previous); await initializeContent(); }
        catch (rollbackError) { setConfigError(`资料库切换中断，请重启应用后检查设置。${String(rollbackError)}`); return; }
        setConfigError(`切换资料库失败：${String(error)}。已恢复原资料库。`);
      } finally { setWorkspaceSwitching(false); }
      return;
    }
    configRef.current = next;
    setConfig(next);
    const revision = ++saveRevision.current;
    setSaving(true);
    try { await queueConfigSave(next); if (revision === saveRevision.current) setConfigError(""); }
    catch (error) { if (revision === saveRevision.current) setConfigError(`设置已临时生效，但未保存：${String(error)}`); }
    finally { if (revision === saveRevision.current) setSaving(false); }
  };
  const enableContentSync = async (previewId: string, remoteLibraryId: string | null) => {
    if (syncEnabling.current) return;
    syncEnabling.current = true;
    try {
      await content.flush();
      await sync.enable(previewId, remoteLibraryId);
    } finally {
      // Initial sync preserves the local library identity, just like later syncs.
      // Keep the modal mounted while the network runs and refresh the existing queue.
      try { await refreshContent(); }
      finally { syncEnabling.current = false; }
    }
  };
  const updateGithub = (status: GithubStatus | null) => {
    setSyncConfig(current => ({ ...current, github: { initialized: true, user: status?.user ?? null, repository: status?.repository ?? null } }));
  };
  const [view, setView] = useState<View>(() => ["search", "tags", "history"].includes(initialConfig.app.launchPage) ? "explore" : initialConfig.app.launchPage as View);
  useEffect(() => { document.title = `Tiker · ${{explore:"探知",library:"文档",reader:"阅读",clips:"收藏",bookmarks:"书签",history:"历史",settings:"设置",search:"搜索",tags:"标签",plugins:"插件"}[view]}`; }, [view]);
  const fontSize = config.app.fontSize;
  const changeFontSize = (mode: FontSizeMode) => { void updateConfig(current => ({ ...current, app: { ...current.app, fontSize: mode } })); };
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedDark = config.app.theme === 'dark' || (config.app.theme === 'system' && systemDark);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    applyFontSize(config.app.fontSize);
    document.documentElement.dataset.theme = resolvedDark ? 'dark' : 'light';
  }, [config.app.fontSize, resolvedDark]);
  const [readerState, setReaderState] = useState<ReaderState>("default");
  const [welcome, setWelcome] = useState(false);
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [documentId,setDocumentId]=useState<string>();
  const [documentOpenVersion,setDocumentOpenVersion]=useState(0);
  const openReader = (state: ReaderState = "default") => { setView("reader"); setReaderState(state); };
  const [searchReset,setSearchReset]=useState(0);
  const [clipOpenRequest,setClipOpenRequest]=useState<{id:string;version:number}>();
  const [tagRequest,setTagRequest]=useState<{source:"documents"|"clips";tag:string;version:number}>();
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchKeyword,setSearchKeyword]=useState('');
  const navigate = (next: View) => { if (syncEnabling.current) return; if(next==='search'){setSearchOpen(true);setSearchReset(v=>v+1);return;} setSearchKeyword('');setWelcome(false); setView(next); };
  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      if (syncEnabling.current || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === config.shortcuts.search) {e.preventDefault();setWelcome(false);setSearchOpen(true);setSearchReset(v=>v+1);}
      if (e.key.toLowerCase() === config.shortcuts.toggleSidebar) { e.preventDefault(); setLibraryVisible(v => !v); }
      if (e.key.toLowerCase() === config.shortcuts.save) e.preventDefault();
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [config.shortcuts]);
  const [clipRequests, setClipRequests] = useState<ClipRequest[]>([]);
  const [clipperError, setClipperError] = useState('');
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void subscribeToClips(requests => {
      setClipRequests(current => [...current, ...requests]);
      if (!syncEnabling.current) { setWelcome(false); setView('clips'); }
    }, setClipperError).then(cleanup => {
      if (disposed) cleanup(); else stop = cleanup;
    }).catch(error => setClipperError(`剪藏连接失败：${String(error)}`));
    return () => { disposed = true; stop?.(); };
  }, []);
  const reading = view === "reader";
  const dark = resolvedDark || (reading && readerState === "dark");
  return <div className={`app-shell${dark ? " shell-dark" : ""}`}>
    <div className="window-top-drag-region" data-tauri-drag-region aria-hidden="true" />
    {workspaceSwitching ? <div className="empty-state" role="status">正在安全切换资料库…</div> : welcome ? <Welcome onEnter={() => setWelcome(false)} /> : <>
      <Navigation view={reading ? "library" : view} onNavigate={navigate} />
      <div className="workspace" key={`${workspaceEpoch}-${persistence.data.libraryId}`}>
        {(persistence.pending > 0 || persistence.error || contentError) && <div className="config-status app-status content-persist-status" role={persistence.error || contentError ? 'alert' : 'status'}>
          {persistence.error || contentError ? `资料尚未完整保存：${persistence.error || contentError}` : `正在保存 ${persistence.pending} 项修改…`}
          {(persistence.error || contentError) && <><button onClick={() => { void content.retry().then(() => setContentError('')).catch(error => setContentError(String(error))); }}>重试保存</button><button onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(persistence.data, null, 2)], { type: 'application/json' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tiker-content-recovery.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出内容备份</button></>}
        </div>}
        {clipperError && <div className="config-status app-status" role="alert">{clipperError}</div>}
        {(configError || saving) && <div className="config-status app-status config-save-status" role={configError ? 'alert' : 'status'}>{configError || '正在保存设置…'}</div>}
        {(view === "library" || view === "bookmarks" || reading) && <Library onSearch={() => {setSearchOpen(true);setSearchReset(v=>v+1);}} tagRequest={tagRequest?.source==="documents"?tagRequest:undefined} searchKeyword={searchKeyword || undefined} initialDocumentId={documentId} documentOpenVersion={documentOpenVersion} key={view === "bookmarks" ? "bookmarks" : "library"} initialScope={view === "bookmarks" ? "我的收藏" : undefined} darkMode={resolvedDark} saveKey={config.shortcuts.save} visible={libraryVisible} onToggle={() => setLibraryVisible(v => !v)} onWelcome={() => setWelcome(true)} initialState={reading ? readerState : undefined} />}
        <Clips openRequest={clipOpenRequest} tagRequest={tagRequest?.source==="clips"?tagRequest:undefined} visible={view === "clips"} clipRequest={clipRequests[0]} onClipRequestConsumed={() => setClipRequests(current => current.slice(1))} />
        {view === "plugins" && <Plugins />}
        <Suspense fallback={view === "explore" ? <div className="empty-state">正在打开探知…</div> : null}><Learning visible={view === "explore"} onSettings={() => navigate("settings")} /></Suspense>
        {view === "settings" && <Suspense fallback={<div className="empty-state">正在打开设置…</div>}><Settings syncConfig={syncConfig} syncError={syncError} onRetrySyncConfig={retrySyncConfig} onSyncDelayChange={changeSyncDelay} onEnableSync={enableContentSync} onGithubChange={updateGithub} fontSize={fontSize} onFontSizeChange={changeFontSize} config={config} onConfigChange={updateConfig} /></Suspense>}
        <Suspense fallback={null}><SearchView shortcut={config.shortcuts.search} visible={searchOpen} onClose={()=>setSearchOpen(false)} resetVersion={searchReset} onOpenClip={(result)=>{setSearchOpen(false);setClipOpenRequest({id:result.id,version:Date.now()});setView("clips");}} onOpenTag={(source,tag)=>{setSearchOpen(false);setDocumentId(undefined);setSearchKeyword('');setTagRequest({source,tag,version:Date.now()});setView(source==="documents"?"library":"clips");}} onOpenDocument={(id,keyword)=>{setSearchOpen(false);setDocumentId(id);setDocumentOpenVersion(v=>v+1);setSearchKeyword(keyword);openReader();}} /></Suspense>
      </div>
    </>}
  </div>;
}
export default App;
