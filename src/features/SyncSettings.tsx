import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { RefreshCw, Pause, Play, X, GitCompareArrows, History } from 'lucide-react';
import { sync, watchSync, type SyncStatus, type SyncPreview, type SyncConflict, type SyncHistoryEntry } from '../services/sync';
import { githubError } from '../services/github';
import { refreshContent } from '../services/content';
import './SyncSettings.css';
import DOMPurify from 'dompurify';

const labels: Record<string, string> = {
  disabled: '待首次同步', pending: '有待同步修改', syncing: '正在同步…', synced: '已同步',
  conflict: '需要处理冲突', error: '同步失败', paused: '已暂停', offline: '离线 · 等待连接',
};
function versionText(value: unknown): string {
  if (value === null || value === undefined) return '此版本中已删除或不存在';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(versionText).join('\n\n');
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, unknown>;
  const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  const parts = [record.title ? `标题：${record.title}` : ''];
  if (Array.isArray(record.tags)) parts.push(`标签：${record.tags.join('、') || '无'}`);
  if (typeof record.favorite === 'boolean') parts.push(`收藏：${record.favorite ? '是' : '否'}`);
  if (typeof record.content === 'string') parts.push('正文：', text(record.content));
  else if (typeof record.markdown === 'string') parts.push('正文：', record.markdown);
  if (record.url) parts.push(`链接：${record.url}`);
  if (record.summary) parts.push(`摘要：${record.summary}`);
  if (record.category) parts.push(`分类：${record.category}`);
  if (Array.isArray(record.messages)) parts.push('会话：', ...record.messages.map(item => String((item as {text?: string}).text ?? '')));
  if (Array.isArray(record.files)) parts.push('材料：', ...record.files.map(versionText));
  return parts.filter(Boolean).join('\n') || '资料结构已变更';
}
export default function SyncSettings({ repository, disabled = false, onEnable, compact=false, options }: { options?: React.ReactNode; repository: string; disabled?: boolean; compact?:boolean; onEnable: (previewId: string, remoteLibraryId: string | null) => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [remoteLibraryId, setRemoteLibraryId] = useState('');
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [mergedBody, setMergedBody] = useState('');
  const [history, setHistory] = useState<SyncHistoryEntry[] | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<SyncHistoryEntry | null>(null);
  const mergedEditor = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const statusRequest = useRef(0);
  const active = isTauri();
  const modalOpen = !!preview || !!conflict || history !== null;
  const editable = conflict?.collection === 'library' && [conflict.local, conflict.remote].some(value => value && typeof value === 'object' && 'kind' in value && value.kind === 'doc');
  useEffect(() => {
    const value = (conflict?.local ?? conflict?.remote) as { content?: string } | null;
    const safe = DOMPurify.sanitize(value?.content ?? '');
    setMergedBody(safe);
    if (mergedEditor.current) mergedEditor.current.innerHTML = safe;
  }, [conflict?.id]);
  useEffect(() => {
    const epoch = ++generation.current;
    let stop: (() => void) | undefined;
    const refresh = () => {
      const request = ++statusRequest.current;
      void sync.status().then(next => { if (epoch === generation.current && request === statusRequest.current) { setStatus(next); setError(''); } })
        .catch(reason => { if (epoch === generation.current && request === statusRequest.current) setError(githubError(reason)); });
    };
    if (active) {
      refresh();
      void watchSync(refresh).then(cleanup => { if (epoch !== generation.current) cleanup(); else stop = cleanup; })
        .catch(reason => { if (epoch === generation.current) setError(githubError(reason)); });
    }
    return () => { generation.current++; stop?.(); };
  }, [repository, active]);
  useEffect(() => {
    if (modalOpen) {
      trigger.current = document.activeElement as HTMLElement;
      if (!dialog.current?.open) dialog.current?.showModal();
      dialog.current?.querySelector<HTMLButtonElement>('.sync-close')?.focus();
    } else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [modalOpen]);
  function close() { if (!busy) { setPreview(null); setConflict(null); setHistory(null); setRestoreVersion(null); } }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    const epoch = generation.current;
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (epoch === generation.current) setError(githubError(reason)); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function apply(action: () => Promise<SyncStatus>) {
    const epoch = generation.current;
    const request = ++statusRequest.current;
    const next = await action();
    if (epoch === generation.current && request === statusRequest.current) setStatus(next);
    await refreshContent();
    const latestRequest = ++statusRequest.current;
    const latest = await sync.status();
    if (epoch === generation.current && latestRequest === statusRequest.current) setStatus(latest);
  }
  return <div className={`sync-settings${compact?' is-compact':''}`}>
    <div className="sync-summary">
      <div className="sync-status-line" role="status" aria-live="polite">
        <span className={`sync-badge sync-badge-${status?.state ?? 'disabled'}`}>{active ? status ? labels[status.state] ?? status.state : '正在读取同步状态…' : '请在桌面应用中启用内容同步'}</span>
        {status && status.pending > 0 && <span>{status.pending} 项待处理</span>}
        {status?.lastSuccess && <span>最近同步 {new Date(status.lastSuccess).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>}
      </div>
    </div>
    {status && <>
      {status.message && !['synced', 'disabled', 'paused'].includes(status.state) && <p role={status.state === 'error' ? 'alert' : 'status'} className={status.state === 'error' ? 'st-error' : ''}>{status.message}</p>}
      {status.blocked?.length > 0 && <div className="sync-warning" role="alert"><strong>以下内容尚未同步</strong><ul>{status.blocked.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      {!!status.attachmentIssues?.length && <div className="sync-attachment-issues">{status.attachmentIssues.map(item => <div key={item.entityId}><span><strong>{item.title}</strong><small>{item.reason}{item.excluded ? ' · 已排除，其他设备仅保留资料信息' : ''}</small></span><button className="st-button" disabled={busy || disabled} onClick={() => void run(() => apply(() => sync.excludeAttachment(item.entityId, !item.excluded)))}>{item.excluded ? '重新纳入同步' : '排除此附件'}</button></div>)}</div>}
      {status.conflicts.length > 0 && <div className="sync-conflicts"><strong>{status.conflicts.length} 项冲突待处理</strong><p>处理完成前，当前资料库暂停写回。你可以继续在本地编辑。</p>{status.conflicts.map(item => <button key={item.id} className="sync-conflict-row" disabled={busy || disabled} onClick={() => setConflict(item)}><GitCompareArrows size={16}/><span>{item.title || item.entityId}</span><span>比较版本 →</span></button>)}</div>}
    </>}
    {error && <p className="st-error" role="alert">{error}</p>}
    <div className="st-inline sync-actions">
      {(!status?.enabled || status.state === 'disabled') ? <button className="st-button st-primary" disabled={!active || !status || busy || disabled} onClick={() => void run(async () => {
        const next = await sync.preview(); setPreview(next); setRemoteLibraryId(next.remoteLibraries[0]?.libraryId ?? '');
      })}>{busy ? '正在检查差异…' : '预览并启用同步'}</button> : <>
        <button className="st-button st-primary" disabled={busy || disabled || status.paused || status.state === 'syncing'} onClick={() => void run(() => apply(sync.now))}><RefreshCw size={15}/>{busy ? '正在处理…' : '立即同步'}</button>
      </>}
      {status?.paused && <button className="st-button" disabled={busy || disabled} onClick={() => void run(() => apply(() => sync.pause(false)))}><Play size={15}/>恢复自动同步</button>}
      <details className="sync-more"><summary>更多选项</summary><div className="sync-more-content">
        {status?.enabled && <div className="st-inline">
          <button className="st-button" disabled={busy || disabled} onClick={() => void run(async () => { setHistory(await sync.history()); setRestoreVersion(null); })}><History size={15}/>版本历史</button>
          {!status.paused && <button className="st-button" disabled={busy || disabled} onClick={() => void run(() => apply(() => sync.pause(true)))}><Pause size={15}/>暂停自动同步</button>}
        </div>}
        {options}
      </div></details>
      {active && !status && <button className="st-button" disabled={busy} onClick={() => void run(async () => setStatus(await sync.status()))}>重试读取状态</button>}
    </div>
    <dialog ref={dialog} className="st-settings sync-dialog" aria-labelledby="sync-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
      <header className="st-dialog-heading"><h2 id="sync-dialog-title">{preview ? '确认首次同步' : conflict ? '处理内容冲突' : '同步版本历史'}</h2><button className="sync-close" aria-label="关闭同步弹框" disabled={busy} onClick={close}><X size={20}/></button></header>
      {preview && <>
        <p>同步至 <strong>{preview.repository}</strong> 的 <strong>{preview.branch}</strong> 分支。当前本地有 {preview.localCount} 项内容。</p>
        {busy && <p role="status" aria-live="polite">{status?.state === 'syncing' ? status.message : '正在校验并同步内容…'} 首次同步可能需要较长时间，请保持应用打开。</p>}
        <fieldset disabled={busy} className="sync-library-options"><legend>选择远程资料库</legend>
          {preview.remoteLibraries.map(item => <label key={item.libraryId}><input type="radio" name="sync-library" value={item.libraryId} checked={remoteLibraryId === item.libraryId} onChange={() => setRemoteLibraryId(item.libraryId)}/><span>加入远程资料库 <code>{item.libraryId}</code><small>{item.count} 项内容 · 与当前本地内容比较合并</small></span></label>)}
          <label><input type="radio" name="sync-library" value="" checked={!remoteLibraryId} onChange={() => setRemoteLibraryId('')}/><span>将当前资料库单独上传<small>创建独立的资料库目录，保留远程已有资料库</small></span></label>
        </fieldset>
        {preview.warnings.length > 0 && <div className="sync-warning" role="alert"><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
        <p className="sync-description">同步包括文档、已归档剪藏、探知记录和可用附件；不上传密钥、模型配置或设备路径。没有共同历史时保留双方新增内容，同一内容存在分歧时交由你处理。</p>
        {error && <p role="alert" className="st-error">{error}</p>}
        <footer className="st-dialog-actions"><button className="st-button" disabled={busy} onClick={close}>取消</button><button className="st-button st-primary" disabled={busy || disabled} onClick={() => void run(async () => { try { await onEnable(preview.previewId, remoteLibraryId || null); setPreview(null); } finally { const next = await sync.status(); setStatus(next); } })}>{busy ? '正在合并并同步…' : remoteLibraryId ? '确认合并并启用' : '确认上传并启用'}</button></footer>
      </>}
      {history !== null && <>
        <p>以下记录来自 GitHub 中当前资料库的真实提交。</p>
        {!history.length ? <p>暂无同步版本。</p> : <div className="sync-history-list">{history.map(entry => <button key={entry.sha} className={`sync-history-entry${restoreVersion?.sha === entry.sha ? ' is-selected' : ''}`} disabled={busy} onClick={() => setRestoreVersion(entry)}><span><strong>{entry.message}</strong><small>{new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small></span><code>{entry.sha.slice(0, 7)}</code></button>)}</div>}
        {restoreVersion && <div className="sync-warning sync-restore-confirm"><strong>恢复所选版本？</strong><p>当前本地内容会先备份。恢复后作为新的修改参与同步，远程提交历史会保留。</p></div>}
        {error && <p role="alert" className="st-error">{error}</p>}
        <footer className="st-dialog-actions"><button className="st-button" disabled={busy} onClick={close}>关闭</button><button className="st-button st-primary" disabled={!restoreVersion || busy || disabled} onClick={() => void run(async () => { if (!restoreVersion) return; await apply(() => sync.restore(restoreVersion.sha)); setHistory(null); setRestoreVersion(null); })}>{busy ? '正在恢复…' : '确认恢复所选版本'}</button></footer>
      </>}
      {conflict && <>
        <p><strong>{conflict.title || conflict.entityId}</strong> 在本地与远程存在不同修改。选择后会重新校验版本；其他版本保留在恢复备份中。</p>
        <div className="sync-versions" key={conflict.entityId}>{([['上次同步版本', conflict.base], ['本地版本', conflict.local], ['远程版本', conflict.remote]] as const).map(([label, value]) => <section key={label}><h3>{label}</h3><pre tabIndex={0} aria-label={label}>{versionText(value)}</pre></section>)}</div>
        {editable && <label className="sync-merged-body"><strong>合并后的正文</strong><span>以当前版本为起点编辑正文，保存后保留其他字段。原始版本会备份。</span><div ref={mergedEditor} className="sync-body-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="合并后的正文" aria-multiline onInput={event => setMergedBody(event.currentTarget.innerHTML)} onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }}/></label>}
        {error && <p role="alert" className="st-error">{error}</p>}
        <footer className="st-dialog-actions sync-resolutions">{editable && <button className="st-button" disabled={busy || disabled} onClick={() => void run(async () => {
          const original = (conflict.local ?? conflict.remote) as Record<string, unknown>;
          const merged: Record<string, unknown> = { ...original, content: DOMPurify.sanitize(mergedBody), updatedAt: Date.now() };
          delete merged.markdown;
          await apply(() => sync.resolve(conflict.id, 'merged', merged)); setConflict(null);
        })}>保存合并正文</button>}{([['local', '使用本地'], ['remote', '使用远程'], ['both', '保留两份']] as const).map(([choice, label]) => <button key={choice} className={`st-button${choice === 'both' ? ' st-primary' : ''}`} disabled={busy || disabled} onClick={() => void run(async () => { await apply(() => sync.resolve(conflict.id, choice)); setConflict(null); })}>{label}</button>)}</footer>
      </>}
    </dialog>
  </div>;
}
