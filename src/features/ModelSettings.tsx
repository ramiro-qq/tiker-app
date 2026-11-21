import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { models, providers, type ModelConfig, type ModelSettings as Model } from '../services/models';

const emptyModel = (): Model => ({ id: '', name: '', provider: 'openai', baseUrl: providers[0].baseUrl, model: '', configured: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function ModelIcon({ name }: { name: 'edit' | 'delete' | 'refresh' | 'copy' }) {
  const paths = {
    edit: <><path d="m15 4 5 5M4 20l4-1 12-12a2 2 0 0 0-4-4L4 15v5Z"/><path d="M13 20h7"/></>,
    delete: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 12M4 12l2.4 6A7 7 0 0 0 17.9 17"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ModelDialog({ onClose, onSaved, existing, items }: { onClose: () => void; onSaved: (config: ModelConfig) => void; existing?: Model; items: Model[] }) {
  const [value, setValue] = useState(() => existing ?? emptyModel());
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (items.some(model => model.id !== value.id && model.name.trim().toLocaleLowerCase() === value.name.trim().toLocaleLowerCase())) { setError('显示名称已存在，请使用其他名称'); return; }
    submitting.current = true;
    setBusy(true); setError('');
    try { onSaved(await models.save(value, key)); }
    catch (reason) { setError(errorText(reason)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="st-settings st-model-dialog" data-theme={document.documentElement.dataset.theme} aria-labelledby="model-dialog-title" onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="st-dialog-heading"><h2 id="model-dialog-title">{existing ? '编辑模型' : '添加模型'}</h2><button type="button" className="st-close" aria-label="关闭模型配置" disabled={busy} onClick={onClose}>×</button></div>
    <form className="st-model-form" onSubmit={event => void submit(event)} aria-busy={busy}>
      <fieldset disabled={busy}>
        <label>显示名称<input autoFocus required maxLength={100} value={value.name} placeholder="例如：日常剪藏助手" onChange={e => setValue(v => ({ ...v, name: e.target.value }))} /></label>
        <label>Provider<select value={value.provider} onChange={e => { const provider = providers.find(p => p.id === e.target.value)!; setValue(v => ({ ...v, provider: provider.id, baseUrl: provider.baseUrl, model: provider.model })); }}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Base URL<input required type="url" value={value.baseUrl} placeholder="https://api.example.com/v1" onChange={e => setValue(v => ({ ...v, baseUrl: e.target.value }))} /><small>填写 API 基础地址，例如 https://api.example.com/v1。</small></label>
        <label>模型 ID<input required value={value.model} placeholder={providers.find(p => p.id === value.provider)?.model || '服务中实际可用的模型 ID'} onChange={e => setValue(v => ({ ...v, model: e.target.value }))} /></label>
        <label>API Key{value.provider === 'ollama' ? '（可选）' : ''}<input type="password" autoComplete="new-password" required={!existing?.configured && value.provider !== 'ollama'} value={key} placeholder={existing?.configured ? '留空保留原密钥' : '请输入服务的 API Key'} onChange={e => setKey(e.target.value)} /><small>模型配置和密钥仅保存在本机 model.json，不参与 GitHub 同步。</small></label>
      </fieldset>
      {error && <p role="alert" className="st-error">{error}</p>}
      {busy && <p role="status">正在测试模型连接，请稍候…</p>}
      <div className="st-dialog-actions"><button type="button" className="st-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="st-button st-primary" disabled={busy}>{busy ? '测试中…' : '确认并测试'}</button></div>
    </form>
  </dialog>, document.body);
}

export default function ModelSettings() {
  const [config, setConfig] = useState<ModelConfig>({ models: [], defaultModelId: null });
  const [editing, setEditing] = useState<Model>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [testingId, setTestingId] = useState<string>();
  const operating = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void models.load().then(v => { if (active) setConfig(v); }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const operate = async (action: 'remove' | 'test' | 'duplicate', model: Model) => {
    if (operating.current) return;
    operating.current = true;
    setBusy(true); setError('');
    if (action === 'test') setTestingId(model.id);
    try {
      if (action === 'test') {
        const result = await models.test(model.id);
        setConfig(result.config);
        if (result.error) setError(`「${model.name}」不可用：${result.error}`);
      } else {
        setConfig(await models[action](model.id));
      }
    } catch (e) { setError(errorText(e)); }
    finally { operating.current = false; setBusy(false); setTestingId(undefined); }
  };
  return <section className="st-panel st-models" data-section="models" aria-labelledby="models-title">
    <div className="st-model-heading"><h2 id="models-title">模型配置</h2><button type="button" className="st-button st-primary" disabled={loading || busy} onClick={() => setAdding(true)}>＋ 添加模型</button></div>
    <div className="st-model-table-scroll">
      <table className="st-model-table" aria-label="模型列表" aria-busy={loading || busy}>
        <thead><tr><th scope="col">模型名称</th><th scope="col">Provider</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={4} className="st-model-table-empty" role="status">正在读取模型配置…</td></tr> : config.models.length === 0 ? <tr><td colSpan={4} className="st-model-table-empty">暂无模型</td></tr> : config.models.map(model => <tr key={model.id}>
            <td><strong>{model.name}</strong></td>
            <td>{providers.find(p => p.id === model.provider)?.name ?? model.provider}</td>
            <td><span role="status" className={`st-model-status ${testingId === model.id ? '' : model.status === 'verified' ? 'is-verified' : model.status === 'unavailable' ? 'is-unavailable' : ''}`} title={testingId === model.id ? '正在测试模型连接' : model.status === 'verified' ? '最近一次连接测试成功' : model.status === 'unavailable' ? '最近一次连接测试失败，点击刷新可重新测试' : '点击刷新测试连接'}>{testingId === model.id ? '测试中…' : model.status === 'verified' ? '已验证' : model.status === 'unavailable' ? '不可用' : '未验证'}</span></td>
            <td><div className="st-model-actions">
              <button type="button" className="st-model-icon" disabled={busy} title="刷新状态" aria-label={`测试 ${model.name} 可用状态`} onClick={() => void operate('test', model)}><ModelIcon name="refresh" /></button>
              <button type="button" className="st-model-icon" disabled={busy} title="复制" aria-label={`复制 ${model.name}`} onClick={() => void operate('duplicate', model)}><ModelIcon name="copy" /></button>
              <button type="button" className="st-model-icon" disabled={busy} title="编辑" aria-label={`编辑 ${model.name}`} onClick={() => setEditing(model)}><ModelIcon name="edit" /></button>
              <button type="button" className="st-model-icon" disabled={busy} title="删除" aria-label={`删除 ${model.name}`} onClick={() => void operate('remove', model)}><ModelIcon name="delete" /></button>
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {error && <div className="st-inline"><p role="alert" className="st-error">{error}</p><button className="st-button" disabled={busy || loading} onClick={() => setReload(v => v + 1)}>重新读取</button></div>}
    {editing && <ModelDialog items={config.models} existing={editing} onClose={() => setEditing(undefined)} onSaved={next => { setConfig(next); setEditing(undefined); setError(''); }} />}
    {adding && <ModelDialog items={config.models} onClose={() => setAdding(false)} onSaved={next => { setConfig(next); setAdding(false); setError(''); }} />}
  </section>;
}
