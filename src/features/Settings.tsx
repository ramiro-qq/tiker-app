import { useModalIsolation } from '../hooks/useModalIsolation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import './Settings.css';
import ModelSettings from './ModelSettings';
import SyncSettings from './SyncSettings';
import { fontSizeOptions, type FontSizeMode } from '../config/typography';
import { github, githubAccess, githubError, needsGithubAuthorization, watchGithubAuthorization, type GithubDeviceCode, type GithubRepository, type GithubStatus } from '../services/github';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { SyncSettings as SyncConfig } from '../config/syncConfig';
import type { AppConfig, ThemeMode } from '../config/appConfig';

type Board = 'overview' | 'authorize' | 'repositories' | 'create';
type IconName = 'settings' | 'palette' | 'cloud' | 'keyboard' | 'info' | 'github' | 'close' | 'copy' | 'refresh' | 'search' | 'plus' | 'external' | 'unlink';
const sections: { label: string; id: string; icon: IconName }[] = [
  { label: '通用', id: 'general', icon: 'settings' },
  { label: '外观', id: 'appearance', icon: 'palette' },
  { label: '同步与备份', id: 'sync', icon: 'cloud' },
  { label: '快捷键', id: 'shortcuts', icon: 'keyboard' },
  { label: '模型配置', id: 'models', icon: 'settings' },
  { label: '关于', id: 'about', icon: 'info' },
];
function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    settings: <><path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.4-4.6 1.5 1.5 0 0 1 .9-2.7H18a3 3 0 0 0 3-3C21 6.5 17 3 12 3Z"/><path d="M7 10h.01M10 6h.01M15 7h.01M6 14h.01"/></>,
    cloud: <path d="M6 18a4 4 0 1 1 .4-8A6 6 0 0 1 18 8a5 5 0 0 1 0 10Z"/>,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
    github: <><path d="M9 19c-4.3 1.3-4.3-2-6-2.5M15 22v-3.5c0-1 .1-1.5-.5-2 3-.3 6-1.5 6-6a4.7 4.7 0 0 0-1.3-3.2 4.4 4.4 0 0 0-.1-3.3S18 3.7 15.5 5a12 12 0 0 0-7 0C6 3.7 4.9 4 4.9 4a4.4 4.4 0 0 0-.1 3.3 4.7 4.7 0 0 0-1.3 3.2c0 4.5 3 5.7 6 6-.5.4-.6 1-.5 2V22"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
    unlink: <><path d="m3 3 18 18M8 16l-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m6-2 2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0M8 2v3M2 8h3m14 3h3m-6 5v3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Button({ children, onClick, primary = false, className = '', disabled = false, type = 'button' }: { children: ReactNode; onClick?: () => void; primary?: boolean; className?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} className={`st-button ${primary ? 'st-primary' : ''} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function scrollToSection(container: HTMLDivElement | null, id: string) {
  const target = container?.querySelector<HTMLElement>(`[data-section="${id}"]`);
  if (!target || !container) return;
  container.scrollTo({
    top: id === 'general' ? 0 : container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 20,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}

export default function Settings({ syncConfig, syncError, onRetrySyncConfig, onSyncDelayChange, onEnableSync, config, onConfigChange, onGithubChange, fontSize, onFontSizeChange }: { syncConfig: SyncConfig; syncError: string; onRetrySyncConfig: () => Promise<void>; onSyncDelayChange: (seconds: number) => Promise<void>; onEnableSync: (previewId: string, remoteLibraryId: string | null) => Promise<void>; onGithubChange: (status: GithubStatus | null) => void; config: AppConfig; onConfigChange: (change: (current: AppConfig) => AppConfig) => Promise<void>; fontSize: FontSizeMode; onFontSizeChange: (mode: FontSizeMode) => void }) {
  const [board, setBoard] = useState<Board>('overview');
  const [anchor, setAnchor] = useState('general');
  const theme = config.app.theme;
  const interval = syncConfig.autoSyncDelaySeconds;
  const workspacePath = config.workspace.currentPath ?? '文稿/tiker';
  const [repos, setRepos] = useState<GithubRepository[]>([]);
  const account = syncConfig.github;
  const access = useSyncExternalStore(githubAccess.subscribe, githubAccess.getSnapshot);
  const requiresAuthorization = needsGithubAuthorization(access.state);
  const statusLabel = access.state === 'checking' ? '正在验证授权…'
    : access.state === 'credential_unavailable' ? '凭据访问受限'
    : requiresAuthorization ? '需要重新授权'
    : access.state === 'network' ? '网络暂不可用'
    : access.state === 'forbidden' ? '访问受限'
    : access.state === 'ready' ? '已授权' : '授权记录已保存';
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [repoRefresh, setRepoRefresh] = useState(0);
  const [repoState, setRepoState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const loadingRepos = repoState === 'loading';
  const generation = useRef(0);
  const [repo, setRepo] = useState(syncConfig.github.repository?.full_name ?? '');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [notice, setNotice] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useModalIsolation(modal,board!=='overview');
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isModal = board === 'authorize' || board === 'repositories' || board === 'create';
  const notify = (message: string) => {
    setNotice(message);
    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotice(''), 3000);
  };
  const changeFontSize = onFontSizeChange;
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const changeWorkspace = async () => {
    if (!isTauri()) { notify('请在桌面应用中选择资料库目录'); return; }
    setChoosingWorkspace(true);
    try {
      const path = await invoke<string | null>('pick_workspace_directory');
      if (path) await onConfigChange(current => ({
        ...current,
        workspace: { ...current.workspace, currentPath: path, recentPaths: [...new Set([path, ...current.workspace.recentPaths])] },
      }));
    } catch (error) { notify(`无法更换目录：${String(error)}`); }
    finally { setChoosingWorkspace(false); }
  };
  const openWorkspace = async () => {
    if (!isTauri()) { notify('请在桌面应用中打开资料库目录'); return; }
    try { await invoke('open_workspace_directory'); }
    catch (error) { notify(`无法打开资料库目录：${String(error)}`); }
  };
  const closeModal = () => {
    if (busy && board !== 'authorize') return;
    generation.current += 1;
    setBusy(false);
    setDevice(null);
    setError('');
    setBoard(board === 'create' ? 'repositories' : 'overview');
    setAnchor('sync');
  };
  useEffect(() => {
    return () => { generation.current += 1; if (notificationTimer.current) clearTimeout(notificationTimer.current); };
  }, []);
  useEffect(() => {
    if (!device) return;
    return watchGithubAuthorization(device, account => {
      onGithubChange(account); setDevice(null); setError(''); setBoard('overview'); setAnchor('sync');
      notify(account.repository ? 'GitHub 授权已恢复' : 'GitHub 授权成功，请选择备份仓库');
    }, reason => { setError(githubError(reason)); setDevice(null); });
  }, [device]);
  useEffect(() => {
    if (board !== 'repositories' || !account?.user) return;
    let active = true;
    setRepoState('loading'); setRepos([]); setRepo(''); setError('');
    void github.repositories().then(items => {
      if (!active) return;
      setRepoState('success'); setRepos(items);
      setRepo(items.some(item => item.full_name === account.repository?.full_name) ? account.repository!.full_name : items[0]?.full_name ?? '');
    }).catch(reason => { if (active) { setRepoState('error'); setError(githubError(reason)); } });
    return () => { active = false; };
  }, [board, account.user?.login, account.repository?.full_name, repoRefresh]);
  useEffect(() => {
    if (!isModal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = modal.current;
    (dialog?.querySelector<HTMLElement>('input:not(:disabled)')||dialog?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      }
      if (event.key === 'Tab' && dialog) {
        const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [board, isModal, busy, account]);
  useEffect(() => {
    if (board !== 'overview') return;
    scrollToSection(scroller.current, anchor);
  }, [board, anchor]);
  const jump = (id: string) => {
    generation.current += 1; setDevice(null); setBusy(false); setError('');
    if (id === anchor && board === 'overview') scrollToSection(scroller.current, id);
    setAnchor(id); setBoard('overview');
  };
  const startAuthorization = async () => {
    const run = ++generation.current;
    setBusy(true); setError(''); setDevice(null);
    try {
      const next = await github.begin();
      if (run !== generation.current) { await github.cancel(next.sessionId); return; }
      setDevice(next);
    } catch (reason) { if (run === generation.current) setError(githubError(reason)); }
    finally { if (run === generation.current) setBusy(false); }
  };
  const runAction = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(githubError(reason)); }
    finally { setBusy(false); }
  };
  const disconnect = () => void runAction(async () => {
    await github.disconnect(); onGithubChange(null); setDevice(null); setRepos([]); setRepo(''); setBoard('overview');
    notify('已解除本机 GitHub 连接。可在 GitHub 应用设置中撤销远端授权。');
  });
  const openAuthorization = () => { setBoard('authorize'); setAnchor('sync'); void startAuthorization(); };
  const openRepositories = () => { setError(''); setRepoState('loading'); setBoard('repositories'); };
  const unbound = <div className="st-unbound"><div className="st-github-status"><h3>GitHub</h3><span className={`st-status ${account?.user && access.state === 'ready' ? 'st-status-connected' : requiresAuthorization ? 'st-status-warning' : ''}`}>{!account.initialized ? '授权状态暂不可用' : account.user ? `${statusLabel} · 待选择仓库` : '未授权'}</span></div><p>{account?.user ? `已连接账号 ${account.user.login}，可选择或创建备份仓库。` : '连接 GitHub 账号，选择用于资料备份的仓库。'}</p><div className="st-inline"><Button primary disabled={busy} onClick={() => { setError(''); if (!account.initialized) void runAction(async () => { onGithubChange(await github.status()); }); else if (account.user) openRepositories(); else openAuthorization(); }}><Icon name="github"/>{!account.initialized ? '重新读取授权状态' : account.user ? '选择备份仓库' : '连接 GitHub'}</Button>{account?.user && <Button disabled={busy} onClick={disconnect}>解除授权</Button>}</div></div>;
  const validName = newName.length <= 100 && newName !== '.' && newName !== '..' && /^[A-Za-z0-9_.-]+$/.test(newName) && !repos.some(item => item.full_name.toLowerCase() === `${account?.user?.login}/${newName}`.toLowerCase());
  const authorizationCard = <div className="st-unbound"><div className="st-github-status"><h3>GitHub</h3><span className="st-status st-status-warning">需要重新授权</span></div><p role="alert">{access.message || 'GitHub 授权已失效，请重新授权。'}</p><div className="st-inline"><Button primary disabled={busy} onClick={openAuthorization}><Icon name="github"/>重新授权</Button></div></div>;
  const repositoryActions = <div className="st-inline"><Button disabled={busy} onClick={openRepositories}>更换仓库</Button><Button disabled={busy} onClick={disconnect}>解除绑定</Button><Button disabled={busy} onClick={()=>void runAction(async()=>{onGithubChange(await github.status());})}>刷新连接</Button></div>;
  const boundCard = requiresAuthorization ? authorizationCard : account?.repository ? <div className="st-bound-card"><button className="st-repo-link" onClick={() => void openUrl(account.repository!.html_url).catch(reason => notify(githubError(reason)))}><Icon name="github"/><span>{account.repository.full_name}</span><Icon name="external" size={14}/></button>{!['ready', 'unknown'].includes(access.state) && <small>{statusLabel}</small>}</div> : unbound;
  return <section className="st-settings" data-theme={theme} aria-label="设置">
    <header className="st-page-path">Tiker / 设置</header>
    <div className="st-canvas">
        <nav className="st-navigation" aria-label="设置分组">{sections.map(section => <button key={section.id} className={anchor === section.id ? 'st-current' : ''} disabled={busy && board !== 'authorize'} onClick={() => jump(section.id)}><Icon name={section.icon}/><span>{section.label}</span></button>)}</nav>
        <div className="st-scroll" ref={scroller}>
        <main className="st-overview-content">
          <h1 className="st-page-title">设置</h1>
          <p className="st-page-description">管理资料库、外观、同步与快捷键。</p>
          <section className="st-panel st-general" data-section="general"><h2>通用</h2><strong>资料库</strong><p>{workspacePath}</p><div className="st-library-actions"><Button onClick={() => void openWorkspace()}>打开目录</Button><Button disabled={choosingWorkspace} onClick={() => void changeWorkspace()}>更换目录</Button></div></section>
          <section className="st-panel st-appearance" data-section="appearance"><h2>外观</h2><h3>主题</h3><p>切换后立即生效</p><div className="st-themes" role="radiogroup" aria-label="主题">{[
            { value: 'light', label: '浅色', description: '米白纸感，长时间写作更柔和' },
            { value: 'dark', label: '深色', description: '低对比黑，夜间阅读不刺眼' },
            { value: 'system', label: '跟随系统', description: '随系统外观自动切换' },
          ].map(item => <button key={item.value} className={`st-theme st-theme-${item.value}`} role="radio" aria-checked={theme === item.value} onClick={() => void onConfigChange(current => ({ ...current, app: { ...current.app, theme: item.value as ThemeMode } }))}><span>{item.label}</span><span className={`st-radio ${theme === item.value ? 'st-checked' : ''}`}/><small>{item.description}</small></button>)}</div><div className="st-font-label"><strong>字号</strong><p>统一调整应用标题、正文与描述字号，立即生效</p></div><div className="st-font-options" role="radiogroup" aria-label="应用字号">{fontSizeOptions.map(({ value, label }) => <button key={value} role="radio" aria-checked={fontSize === value} className={fontSize === value ? 'st-selected' : ''} onClick={() => changeFontSize(value)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
            const nextIndex = (fontSizeOptions.findIndex(option => option.value === value) + direction + fontSizeOptions.length) % fontSizeOptions.length;
            changeFontSize(fontSizeOptions[nextIndex].value);
            (event.currentTarget.parentElement?.children[nextIndex] as HTMLButtonElement)?.focus();
          }} tabIndex={fontSize === value ? 0 : -1}>{label}</button>)}</div></section>
          <section className="st-panel st-sync-panel" data-section="sync"><h2>同步与备份</h2>{syncError ? <div role="alert"><p className="st-error">{syncError}</p><Button onClick={() => void onRetrySyncConfig()}>重新读取同步配置</Button></div> : <>{boundCard}{account.repository && !requiresAuthorization && <SyncSettings key={account.repository.full_name} repository={account.repository.full_name} disabled={busy} onEnable={onEnableSync} options={<>{repositoryActions}<div className="st-interval"><div><strong>修改后自动同步</strong><p>连续修改将合并同步，远程更新自动检查。</p></div><div className="st-inline" role="radiogroup" aria-label="修改后自动同步等待时间">{[2, 4, 10].map(value => <Button key={value} primary={value === interval} onClick={() => void onSyncDelayChange(value)}><span role="radio" aria-checked={value === interval}>{value} 秒</span></Button>)}</div></div></>}/>}
          {(error || access.message) && !isModal && !requiresAuthorization && <div className="st-inline-error" role="alert"><p className="st-error">{error || access.message}</p><Button disabled={busy} onClick={openRepositories}>重试连接</Button></div>}</>}</section>
          <section className="st-panel st-shortcuts" data-section="shortcuts"><h2>快捷键</h2><p>⌘ {config.shortcuts.search.toUpperCase()}　 打开全局搜索弹框并聚焦输入</p><p>⌘ {config.shortcuts.save.toUpperCase()}　 保存当前文档</p><p>Esc　 关闭弹框并返回当前页面</p></section><ModelSettings />

          <section className="st-panel st-about" data-section="about"><h2>关于</h2><p>阅读、剪藏与写作空间 · v{__APP_VERSION__}</p><p>资料库：{workspacePath}</p></section>
        </main>
      </div>
    </div>
    {isModal && createPortal(<div className={`st-overlay st-settings ${board === 'authorize' ? 'st-auth-overlay' : 'st-full-overlay'}`} data-theme={theme} >
      <div className={`st-dialog st-dialog-${board}`} ref={modal} role="dialog" aria-modal="true" aria-labelledby="st-dialog-title" tabIndex={-1}>
        <div className="st-dialog-heading"><h2 id="st-dialog-title">{board === 'authorize' ? '授权 GitHub' : board === 'create' ? '新增仓库' : '选择同步仓库'}</h2><button className="st-close" disabled={busy && board !== 'authorize'} onClick={closeModal} aria-label="关闭弹框"><Icon name="close" size={18}/></button></div>
        {error && <p className="st-error" role="alert">{error}</p>}
        {board === 'authorize' ? <><p>获取设备码后，在浏览器中登录 GitHub 并输入设备码。完成授权后会自动继续。</p><small>授权将允许应用读取账号信息，并访问你有权限的公开和私有仓库。</small><div className="st-device-code"><div className="st-device-tools"><small>设备码</small><button disabled={!device} aria-label="复制设备码" onClick={() => { if (device) void navigator.clipboard.writeText(device.userCode).then(() => notify('设备码已复制')).catch(() => notify('复制失败，请手动复制设备码')); }}><Icon name="copy"/></button><button disabled={busy} aria-label="刷新设备码" onClick={() => void startAuthorization()}><Icon name="refresh"/></button></div><span>{device?.userCode ?? (busy ? '获取中…' : '等待获取')}</span></div>{device && <p role="status">等待 GitHub 授权 · 设备码有效期 {Math.ceil(device.expiresIn / 60)} 分钟，过期后请刷新。</p>}<div className="st-dialog-actions"><Button onClick={closeModal}>取消授权</Button>{device ? <Button primary onClick={() => void openUrl(device.verificationUri).catch(reason => setError(githubError(reason)))}>前往 GitHub 授权<Icon name="external"/></Button> : <Button primary disabled={busy} onClick={() => void startAuthorization()}>{busy ? '正在获取…' : '获取设备码'}</Button>}</div></> : requiresAuthorization ? <><p>GitHub 授权已失效，请重新授权。</p><div className="st-dialog-actions"><Button primary disabled={busy} onClick={openAuthorization}>重新授权</Button></div></> : board === 'repositories' ? <><p>{requiresAuthorization ? 'GitHub 授权已失效，请重新授权。' : repoState === 'error' ? '读取失败，请稍后重试。' : loadingRepos ? '正在验证凭据并读取仓库，请稍候。' : `当前账号 ${account?.user?.login ?? '未登录'}：请选择可写入的仓库。`}</p><label className="st-search"><Icon name="search"/><input aria-label="搜索仓库名称" placeholder="搜索仓库名称…" disabled={repoState !== 'success'} value={query} onChange={event => setQuery(event.target.value)}/></label>{loadingRepos ? <p role="status">正在读取 GitHub 仓库…</p> : repoState === 'success' && <div className="st-repo-grid" role="radiogroup" aria-label="同步仓库">{repos.filter(item => item.full_name.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.id} disabled={busy} role="radio" aria-checked={repo === item.full_name} className={`st-repo-option ${repo === item.full_name ? 'st-option-selected' : ''}`} onClick={() => setRepo(item.full_name)}><span className={`st-radio ${repo === item.full_name ? 'st-checked' : ''}`}/><span><span>{item.full_name}</span><small>{item.private ? '私有' : '公开'} · 可读写</small></span></button>)}<button className="st-add-repo" disabled={busy || !account?.user} aria-label="新增仓库" onClick={() => { setNewName(''); setDescription(''); setIsPrivate(true); setError(''); setBoard('create'); }}><Icon name="plus" size={24}/></button></div>}{repoState === 'success' && !repos.length && <p>暂无可写仓库，可创建一个私有仓库后绑定。</p>}<div className="st-dialog-actions">{!requiresAuthorization && <Button disabled={busy || loadingRepos} onClick={() => { setRepoRefresh(value => value + 1); }}>{repoState === 'error' ? '重试读取' : '刷新列表'}</Button>}{requiresAuthorization && <Button disabled={busy} onClick={openAuthorization}>重新授权</Button>}<Button primary disabled={repoState !== 'success' || requiresAuthorization || !repo || busy || loadingRepos || !repos.some(item => item.full_name === repo)} onClick={() => void runAction(async () => { const status = await github.bind(repo); onGithubChange(status); setBoard('overview'); setAnchor('sync'); setQuery(''); notify('仓库已绑定'); })}>{busy ? '正在绑定…' : '确认绑定'}</Button></div></> : <form className="st-create-form" onSubmit={event => { event.preventDefault(); if (!validName || busy) return; void runAction(async () => { const created = await github.create(newName, description, isPrivate); setRepos(items => [created, ...items]); setRepo(created.full_name); setQuery(''); setBoard('repositories'); notify('已在 GitHub 创建仓库，请确认绑定'); }); }}><p>将在 GitHub 账号 {account?.user?.login} 下创建真实仓库，默认私有。</p><label className="st-field"><span>仓库名称 *</span><input value={newName} onChange={event => setNewName(event.target.value)} placeholder="例如：my-reading-library" required maxLength={100} pattern="[A-Za-z0-9_.\-]+" aria-describedby="st-name-hint"/><small id="st-name-hint">支持字母、数字、点、连字符和下划线，最多 100 字符。</small>{newName && !validName && <small className="st-error">仓库名称格式不正确或已存在。</small>}</label><label className="st-field"><span>描述（选填）</span><input value={description} onChange={event => setDescription(event.target.value)} placeholder="简单描述这个资料库"/></label><fieldset className="st-visibility"><legend>可见性</legend><div>{[{ value: true, label: '私有', detail: '仅你及受邀成员可访问' }, { value: false, label: '公开', detail: '任何人均可查看仓库' }].map(item => <button key={item.label} type="button" role="radio" aria-checked={isPrivate === item.value} className={`st-repo-option ${isPrivate === item.value ? 'st-option-selected' : ''}`} onClick={() => setIsPrivate(item.value)}><span className={`st-radio ${isPrivate === item.value ? 'st-checked' : ''}`}/><span><span>{item.label}</span><small>{item.detail}</small></span></button>)}</div></fieldset><div className="st-dialog-actions"><Button disabled={busy} onClick={closeModal}>取消</Button><Button primary type="submit" disabled={!validName || busy}>创建仓库</Button></div></form>}
      </div>
    </div>, document.body)}
    {notice && createPortal(<div className="st-notice" role="status">{notice}</div>, document.body)}
  </section>;
}
