import { useEffect, useState } from 'react';
import { Check, CircleCheck, ChevronDown, CircleAlert, LoaderCircle, Square, Bot } from 'lucide-react';
import type { TraceRun } from '../../shared/agent/progress';
import type { Material } from './model';
import { tracePhase } from './conversation';

function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
// A public activity trace: summaries and observed operations, never raw model reasoning.
export default function Trace({ run, summary = '', hasResponse = false, files = [] }: {
  run: TraceRun; summary?: string; hasResponse?: boolean; files?: Material[];
}) {
  const phase = tracePhase(run, hasResponse);
  const [disclosure, setDisclosure] = useState<{ phase: string; open: boolean }>();
  const open = disclosure?.phase === phase ? disclosure.open : phase !== 'responded';
  const [now, setNow] = useState(Date.now());
  const running = run.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, run.state]);
  const latest = run.steps[run.steps.length - 1];
  const active = [...run.steps].reverse().find(s => s.state === 'running');
  const label = running ? active?.label ?? '正在启动探知' : run.state === 'stopped' ? '本轮已停止' : run.state === 'error' ? '本轮未完成' : '本轮处理完成';
  const completed = run.steps.filter(step => step.state === 'done').length;
  const Icon = running ? LoaderCircle : run.state === 'done' ? Check : run.state === 'error' ? CircleAlert : Square;
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const silence = now - (latest?.updatedAt ?? run.startedAt);
  return <div className="tz-message assistant tz-trace-message">
    <span className="tz-avatar"><Bot size={15} /></span>
    <section className="tz-trace" aria-label="探知过程">
      <button className={`tz-trace-toggle${phase === 'responded' ? ' is-responded' : ''}`} aria-label={`${label}，已用 ${duration(elapsed)}，${open ? "收起" : "展开"}过程记录`} aria-expanded={open} aria-controls={`trace-${run.id}`} onClick={() => setDisclosure({ phase, open: !open })}>
        {phase !== 'responded' && <Icon size={15} className={running ? 'tz-spin' : undefined} />}
        <span className="tz-trace-heading" role="status" aria-live="polite">{phase === 'responded' ? `用时 ${duration(elapsed)}` : label}</span>
        {phase !== 'responded' && <span className="tz-trace-time">已用 {duration(elapsed)}</span>}
        <ChevronDown size={14} className={open ? 'is-open' : undefined} />
      </button>
      <div id={`trace-${run.id}`} className="tz-trace-content" hidden={!open}>
        {summary && <p className="tz-trace-summary">{summary}</p>}
        <p className="tz-trace-count">已完成 {completed} / {run.steps.length} 个步骤</p>
        <ol className="tz-trace-steps">
          {run.steps.map(step => {
            const Marker = step.state === 'running' ? LoaderCircle : step.state === 'done' ? CircleCheck : step.state === 'stopped' ? Square : CircleAlert;
            if (step.id.startsWith('file:')) return <li key={step.id} className="tz-file-operation" data-state={step.state}>
              <div><span>{step.label}</span><p>{step.state === 'running' ? '● ' : step.state === 'done' ? '✓ ' : '○ '}{step.detail}</p></div>
            </li>;
            return <li key={step.id} data-state={step.state}>
              <span className="tz-trace-marker"><Marker size={13} className={step.state === 'running' ? 'tz-spin' : undefined} /></span>
              <div><div className="tz-trace-step-title"><span>{step.label}</span></div>
                {step.detail && <p>{step.detail}</p>}</div>
            </li>;
          })}
        </ol>
        {files.length > 0 && !run.steps.some(step => step.id.startsWith('file:')) && <div className="tz-trace-files" aria-label="文件生成结果">
          <span>file-write · {files.length} 份材料已校验</span>
          {files.map(file => <p key={file.id}><Check size={12} />{file.name}</p>)}
        </div>}
        {running && <p className="tz-trace-wait">{silence >= 15 ? `最近 ${duration(silence)} 暂无新结果，仍在等待当前请求。你可以随时停止。` : '按实际执行结果更新，可随时停止。'}</p>}
      </div>
    </section>
  </div>;
}
