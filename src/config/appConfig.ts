import { invoke, isTauri } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";
export type LaunchPage = "search" | "explore" | "library" | "clips" | "tags" | "history" | "settings";
export interface AppConfig {
  version: number;
  app: {
    language: "zh-CN";
    theme: ThemeMode;
    launchPage: LaunchPage;
    fontSize: "small" | "medium" | "large";
  };
  workspace: { currentPath: string | null; recentPaths: string[] };
  window: { width: number; height: number; maximized: boolean };
  shortcuts: { search: string; toggleSidebar: string; save: string };
}
export const defaultAppConfig: AppConfig = {
  version: 1,
  app: { language: "zh-CN", theme: "system", launchPage: "explore", fontSize: "medium" },
  workspace: { currentPath: null, recentPaths: [] },
  window: { width: 1180, height: 760, maximized: false },
  shortcuts: { search: "k", toggleSidebar: "b", save: "s" },
};
export async function loadAppConfig(): Promise<AppConfig> {
  const config = isTauri()
    ? await invoke<Omit<AppConfig, "app"> & { app: Omit<AppConfig["app"], "launchPage"> & { launchPage: LaunchPage | "search" } }>("load_app_config")
    : structuredClone(defaultAppConfig);
  if (config.app.launchPage === "search") config.app.launchPage = "explore";
  return config;
}
export async function saveAppConfig(config: AppConfig): Promise<void> {
  if (!isTauri()) throw new Error("浏览器预览不写入桌面配置，请在桌面应用中修改设置。");
  await invoke("save_app_config", { config });
}

let pendingSave: Promise<void> = Promise.resolve();
export function queueConfigSave(config: AppConfig): Promise<void> {
  const snapshot = structuredClone(config);
  const result = pendingSave.then(() => saveAppConfig(snapshot));
  pendingSave = result.catch(() => {});
  return result;
}
