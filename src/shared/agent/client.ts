import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { ProgressEvent } from './progress';
import { createAgentTransport } from './transport';

export const requestAgent = createAgentTransport({
  available: isTauri,
  invoke: (command, args) => invoke(command, args),
  channel: receive => {
    const channel = new Channel<ProgressEvent>();
    channel.onmessage = receive;
    return channel;
  },
});
