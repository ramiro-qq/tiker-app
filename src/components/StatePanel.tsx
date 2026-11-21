import type { ReactNode } from 'react';
import './StatePanel.css';
type Props = { kind?: 'empty' | 'search' | 'error' | 'loading'; title: string; description?: string; actions?: ReactNode };
export default function StatePanel({ kind = 'empty', title, description, actions }: Props) {
  return <div className={`state-panel state-panel-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading'}>
    <span className="state-panel-symbol"><svg width="36" height="36" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'search' ? <><circle cx="21" cy="21" r="12" /><path d="m30 30 10 10M16 21h10" /></> : kind === 'error' ? <><path d="m24 7 19 33H5L24 7Z" /><path d="M24 18v10m0 5h.01" /></> : kind === 'loading' ? <path d="M39 24a15 15 0 1 1-15-15" /> : <><path d="M9 10h30v29l-15-8-15 8V10Z" /><path d="M18 18h12M18 24h8" /></>}
    </svg></span><h2>{title}</h2>{description && <p>{description}</p>}{actions && <div className="state-panel-actions">{actions}</div>}
  </div>;
}
