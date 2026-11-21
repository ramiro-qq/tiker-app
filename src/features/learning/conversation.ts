import type { TraceRun } from '../../shared/agent/progress';
import type { Message } from './model';

// A response only belongs to this run until the next user message.
export function conversationTrace(messages: Message[], runs: TraceRun[], anchorId: string) {
  const run = runs.find(run => run.anchorId === anchorId);
  const index = messages.findIndex(message => message.id === anchorId);
  const anchor = messages[index];
  const following = messages.slice(index + 1);
  const boundary = following.findIndex(message => message.role === 'user');
  const turn = boundary < 0 ? following : following.slice(0, boundary);
  return {
    run,
    summary: messages.find(message => message.id === run?.summaryMessageId)?.text ?? (anchor?.role === 'assistant' ? anchor.text : ''),
    hasResponse: turn.some(message => message.role === 'assistant' && message.id !== run?.summaryMessageId),
  };
}
export function tracePhase(run: TraceRun, hasResponse: boolean) {
  if (hasResponse || run.state === 'done') return 'responded';
  return run.state === 'running' ? 'working' : 'interrupted';
}
