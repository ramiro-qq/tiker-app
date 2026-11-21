import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import brandMark from '../assets/brand-mark.svg';
import './Plugins.css';

export default function Plugins() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try {
      if (isTauri()) {
        await invoke<boolean>('download_browser_extension');
      } else {
        const link = document.createElement('a');
        link.href = `${import.meta.env.BASE_URL}downloads/tiker-clipper.zip`;
        link.download = 'tiker-clipper.zip';
        link.click();
      }
    } catch { setError('下载失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <main className="plugins-page">
    <header className="topbar">插件</header>
    <div className="plugins-content">
      <section className="plugins-product" aria-labelledby="clipper-title">
        <img src={brandMark} width="44" alt="" />
        <div className="plugins-info"><h1 id="clipper-title">Tiker 一键剪藏</h1><p>在浏览器中一键收藏网页，自动填入客户端剪藏任务。</p><span>Chrome / Edge</span></div>
        <button className="primary-button" disabled={busy} onClick={() => void download()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
          {busy ? '正在保存…' : '下载插件'}
        </button>
      </section>
      {error && <p className="plugins-error" role="alert">{error}</p>}
      <section className="plugins-install" aria-labelledby="plugins-install-title">
        <h2 id="plugins-install-title">安装步骤</h2>
        <ol className="plugins-steps">
          <li><div className="plugins-step-content"><h3>下载并解压</h3><p>点击上方「下载插件」，将安装包解压到固定文件夹。</p></div></li>
          <li><div className="plugins-step-content"><h3>加载浏览器扩展</h3><p>在地址栏输入对应地址，进入扩展管理页面。</p><div className="plugins-browser-addresses"><span>Chrome <code>chrome://extensions</code></span><span>Edge <code>edge://extensions</code></span></div><p>开启「开发者模式」，点击「加载已解压的扩展程序」，选择刚刚解压的文件夹。</p></div></li>
          <li><div className="plugins-step-content"><h3>固定插件，开始剪藏</h3><p>将 Tiker 固定到浏览器工具栏。遇到喜欢的网页，点击插件图标或右键「一键剪藏」即可。</p></div></li>
        </ol>
      </section>
    </div>
  </main>;
}
