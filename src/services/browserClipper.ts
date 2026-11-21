import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface ClipRequest { requestId: string; url: string; title: string }

export async function subscribeToClips(onRequests: (requests: ClipRequest[]) => void, onError: (message: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  let disposed = false;
  let draining = false;
  let again = false;
  const drain = async () => {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        const requests = await invoke<ClipRequest[]>('take_clip_requests');
        if (requests.length) onRequests(requests);
      } while (again && !disposed);
    } catch (error) { onError(`无法接收浏览器剪藏：${String(error)}`); }
    finally { draining = false; }
  };
  const unlisten = await listen('clipper:pending', () => { if (!disposed) void drain(); });
  void drain();
  return () => { disposed = true; unlisten(); };
}
