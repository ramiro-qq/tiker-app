export type StepState = 'running' | 'done' | 'warning' | 'error' | 'stopped';
export interface ProgressEvent { id: string; label: string; detail: string; state: StepState; kind?: 'material' | 'response'; material?: {name:string;title:string;markdown:string}; response?: string; }
export interface TraceStep extends ProgressEvent { startedAt: number; updatedAt: number; }
export interface TraceRun {
  id: string; anchorId: string; summaryMessageId?: string; startedAt: number; endedAt?: number;
  state: 'running' | 'done' | 'stopped' | 'error'; steps: TraceStep[];
}
export function createTrace(id: string, anchorId: string, now = Date.now()): TraceRun {
  return { id, anchorId, startedAt: now, state: 'running', steps: [] };
}
export function updateTrace(run: TraceRun, event: ProgressEvent, now = Date.now()): TraceRun {
  if (run.state !== 'running' || event.kind === 'response') return run;
  const previous = run.steps.find(s => s.id === event.id);
  if (previous && previous.state !== 'running') return run;
  const step = { id:event.id, label:event.label, detail:event.detail, state:event.state, startedAt: previous?.startedAt ?? now, updatedAt: now };
  return { ...run, steps: previous ? run.steps.map(s => s.id === event.id ? step : s) : [...run.steps, step] };
}
export function finishTrace(run: TraceRun, state: TraceRun['state'], now = Date.now()): TraceRun {
  if (run.state !== 'running' || state === 'running') return run;
  return { ...run, state, endedAt: now, steps: run.steps.map(s => s.state === 'running'
    ? { ...s, state: state === 'done' ? 'done' : state, updatedAt: now } : s) };
}
