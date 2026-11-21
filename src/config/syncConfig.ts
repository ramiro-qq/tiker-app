import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GithubRepository } from "../services/github";

/** Display settings only. The disk file and its credentials remain inside Rust. */
export interface SyncSettings {
  autoSyncDelaySeconds: number;
  github: { initialized: boolean; user: { login: string } | null; repository: GithubRepository | null };
}
export const defaultSyncSettings: SyncSettings = {
  autoSyncDelaySeconds: 4,
  github: { initialized: true, user: null, repository: null },
};
export async function loadSyncSettings(): Promise<SyncSettings> {
  return isTauri() ? invoke<SyncSettings>("load_sync_settings") : structuredClone(defaultSyncSettings);
}
let pendingSave: Promise<unknown> = Promise.resolve();
export function saveSyncDelay(seconds: number): Promise<SyncSettings> {
  if (!isTauri()) return Promise.reject(new Error("请在桌面应用中修改同步设置。"));
  const result = pendingSave.then(() => invoke<SyncSettings>("save_sync_delay", { seconds }));
  pendingSave = result.catch(() => {});
  return result;
}
