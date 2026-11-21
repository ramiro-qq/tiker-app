import { requestAgent } from './client';
import type { AgentMessage, AgentMaterial, AgentModelOptions, Source, Intent, Research, Generated, StudyPlan } from './contracts';
import type { ProgressEvent } from './progress';

function call<T>(command: string, args: Record<string, unknown>, signal?: AbortSignal, options?: (event: ProgressEvent) => void): Promise<T> {
  // Every Agent command declares a progress channel, including callers without a listener.
  return requestAgent<T>(command, args, { signal, cancelCommand: 'learning_cancel', progress: options ?? (() => {}) });
}
export const learningAgent = {
  intent: (
    text: string,
    topic: string,
    messages: AgentMessage[],
    signal?: AbortSignal,
    options?: AgentModelOptions,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Intent> =>
    call("learning_intent", { text, topic, messages, options }, signal, onProgress),
  research: (query: string, seedUrls: string[], messages: AgentMessage[], signal?: AbortSignal, options?: AgentModelOptions, onProgress?: (event: ProgressEvent) => void): Promise<Research> =>
    call("learning_research", { query, seedUrls, messages, options }, signal, onProgress),
  generate: (
    topic: string,
    messages: AgentMessage[],
    sources: Source[],
    files: AgentMaterial[],
    warning: string,
    plan: StudyPlan,
    signal?: AbortSignal,
    options?: AgentModelOptions,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Generated> =>
    call(
      "learning_generate",
      { topic, messages, sources, files, warning, plan, options },
      signal,
      onProgress,
    ),
};
