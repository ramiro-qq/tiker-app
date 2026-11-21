import type { ProgressEvent } from './progress.ts';

export interface AgentAdapter {
  available(): boolean;
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  channel(receive: (event: ProgressEvent) => void): unknown;
}
export interface AgentCallOptions {
  signal?: AbortSignal;
  cancelCommand?: string;
  progress?: (event: ProgressEvent) => void;
}

// Transport owns request lifetime; feature clients supply command names and payloads.
export function createAgentTransport(adapter: AgentAdapter) {
  return async function request<T>(
    command: string,
    args: Record<string, unknown>,
    { signal, cancelCommand, progress }: AgentCallOptions = {},
  ): Promise<T> {
    if (!adapter.available()) throw new Error(
      '请在桌面应用中使用探知，并先在设置 → 模型配置中配置默认模型。浏览器仅供界面预览。',
    );
    signal?.throwIfAborted();
    let settled = false;
    if (progress) args = { ...args, onProgress: adapter.channel(event => {
      if (!settled && !signal?.aborted) progress(event);
    }) };
    const requestId = signal && cancelCommand ? crypto.randomUUID() : undefined;
    if (requestId) args = { ...args, requestId };
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { settled = true; signal?.removeEventListener('abort', abort); };
      const abort = () => {
        cleanup();
        if (requestId && cancelCommand) void adapter.invoke(cancelCommand, { requestId }).catch(() => {});
        reject(new DOMException('本轮已停止', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      // Check again after installing the listener to cover cancellation during channel setup.
      if (signal?.aborted) { abort(); return; }
      void adapter.invoke(command, args).then(
        value => { cleanup(); resolve(value as T); },
        error => { cleanup(); reject(error); },
      );
    });
  };
}
