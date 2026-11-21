import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyFontSize } from "./config/typography";
import { defaultAppConfig, loadAppConfig } from "./config/appConfig";
import "./typography.css";
import { defaultSyncSettings, loadSyncSettings } from "./config/syncConfig";
import { initializeContent } from "./services/content";
import { isTauri } from "@tauri-apps/api/core";

// Only the macOS desktop window draws native controls over the web content.
if (isTauri() && /Mac/.test(navigator.platform)) {
  document.documentElement.dataset.windowChrome = "macos-overlay";
}

async function start() {
  let config = structuredClone(defaultAppConfig);
  let configError = "";
  try { config = await loadAppConfig(); }
  catch (error) { configError = `配置加载失败，已使用临时默认值，原文件未修改。${String(error)}`; }
  try {
    if (configError) throw new Error(configError);
    await initializeContent();
  } catch (error) {
    const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
    root.render(<main className="content-start-error"><h1>资料暂时无法打开</h1><p>原始数据已保留。请重试，避免在空资料库中覆盖已有内容。</p><pre>{String(error)}</pre><button className="primary-button" onClick={() => location.reload()}>重试打开</button></main>);
    return;
  }
  let syncSettings = structuredClone(defaultSyncSettings);
  let syncError = "";
  try { syncSettings = await loadSyncSettings(); }
  catch (error) { syncError = `同步配置加载失败：${String(error)}`; }
  applyFontSize(config.app.fontSize);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initialConfig={config} initialConfigError={configError} initialSyncSettings={syncSettings} initialSyncError={syncError} />
    </React.StrictMode>,
  );
}
void start();
