import { invoke, isTauri } from '@tauri-apps/api/core';

export interface GithubRepository {
  id: number; name: string; full_name: string; private: boolean; html_url: string;
}
export interface GithubStatus {
  user: { login: string } | null;
  repository: GithubRepository | null;
  authorizationAvailable: boolean;
}
export interface GithubDeviceCode {
  sessionId: number; userCode: string; verificationUri: string; expiresIn: number; interval: number;
}
export interface GithubPoll {
  status: 'pending' | 'authorized'; interval: number; account: GithubStatus | null;
}
export type GithubAccessState = 'unchecked' | 'checking' | 'ready' | 'credential_missing' | 'credential_invalid' | 'credential_unavailable' | 'unauthorized' | 'account_mismatch' | 'network' | 'forbidden';
export interface GithubAccess { state: GithubAccessState; message: string }
const listeners = new Set<() => void>();
let access: GithubAccess = { state: 'unchecked', message: '' };
const setAccess = (state: GithubAccessState, message = '') => {
  access = { state, message };
  listeners.forEach(listener => listener());
};
const accessErrors = new Set<string>(['credential_missing', 'credential_invalid', 'credential_unavailable', 'unauthorized', 'account_mismatch', 'network', 'forbidden']);
export const githubAccess = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => access,
};
export const needsGithubAuthorization = (state: GithubAccessState) => ['credential_missing', 'credential_invalid', 'credential_unavailable', 'unauthorized', 'account_mismatch'].includes(state);
export function githubError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}
function reportError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && accessErrors.has(error.code)) {
    setAccess(error.code as GithubAccessState, githubError(error));
  }
}
export async function githubRequest<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  setAccess('checking');
  try {
    const result = await command<T>(name, args);
    setAccess('ready');
    return result;
  } catch (error) {
    // Preserve the useful previous authorization error for errors unrelated to auth.
    reportError(error);
    if (access.state === 'checking') setAccess('unchecked');
    throw error;
  }
}
function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('请在桌面应用中连接 GitHub，浏览器预览不支持授权。'));
  return invoke<T>(name, args);
}
export const github = {
  status: () => githubRequest<GithubStatus>('github_status'),
  begin: () => command<GithubDeviceCode>('github_begin_auth'),
  poll: async (sessionId: number) => {
    try {
      const result = await command<GithubPoll>('github_poll_auth', { sessionId });
      if (result.status === 'authorized') setAccess('ready');
      return result;
    } catch (error) {
      // A failed attempt to obtain new credentials cannot make old ones valid.
      if (!needsGithubAuthorization(access.state)) reportError(error);
      throw error;
    }
  },
  cancel: (sessionId: number) => command<void>('github_cancel_auth', { sessionId }),
  repositories: () => githubRequest<GithubRepository[]>('github_list_repositories'),
  create: (name: string, description: string, privateRepo: boolean) => githubRequest<GithubRepository>('github_create_repository', { name, description, private: privateRepo }),
  bind: (fullName: string) => githubRequest<GithubStatus>('github_bind_repository', { fullName }),
  disconnect: async () => {
    try { await command<void>('github_disconnect'); setAccess('unchecked'); }
    catch (error) { reportError(error); throw error; }
  },
};

// Retry the existing device session: exchanging a new device code would discard
// a token that Rust may already have received before /user temporarily failed.
export function watchGithubAuthorization(
  device: Pick<GithubDeviceCode, 'sessionId' | 'interval'>,
  onAuthorized: (account: GithubStatus) => void,
  onError: (error: unknown) => void,
) {
  let active = true;
  let completed = false;
  let failures = 0;
  let interval = Math.max(5, device.interval);
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const result = await github.poll(device.sessionId);
      if (!active) return;
      failures = 0;
      if (result.status === 'authorized' && result.account) {
        completed = true;
        onAuthorized(result.account);
      } else {
        interval = Math.max(5, result.interval);
        timer = setTimeout(() => void poll(), interval * 1000);
      }
    } catch (error) {
      if (!active) return;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'network' && failures < 3) {
        timer = setTimeout(() => void poll(), Math.max(interval, 5 * 2 ** failures++) * 1000);
      } else onError(error);
    }
  };
  timer = setTimeout(() => void poll(), interval * 1000);
  return () => {
    active = false;
    clearTimeout(timer);
    if (!completed) void github.cancel(device.sessionId).catch(() => {});
  };
}
