import type { LearningSession } from './model';
import type { ProgressEvent } from '../../shared/agent/progress';

export function applyGenerationEvent(session: LearningSession, event: ProgressEvent, responseId: string): LearningSession {
  if (event.kind === 'material' && event.material) {
    const value = event.material;
    const previous = session.files.find(file => file.name === value.name);
    const file = {...value, id: previous?.id ?? crypto.randomUUID(), status: event.state === 'done' ? 'ready' as const : 'generating' as const};
    return {...session, files: previous ? session.files.map(old => old.id === file.id ? file : old) : [...session.files, file]};
  }
  if (event.kind === 'response' && event.response?.trim()) {
    const response = {id:responseId,role:'assistant' as const,text:event.response};
    return {...session,messages:session.messages.some(message => message.id === responseId) ? session.messages.map(message => message.id === responseId ? response : message) : [...session.messages,response]};
  }
  return session;
}
export function settleDrafts(session: LearningSession, status: 'error' | 'stopped'): LearningSession {
  return {...session,files:session.files.map(file => file.status === 'generating' ? {...file,status} : file)};
}
