import { EngineSession } from '../features/preview/session';
import { createEngine } from '../features/preview/engines/registry';
import { validateSize } from '../features/preview/format';
import { closeFile, openFile } from './files';
export class PreviewSession extends EngineSession {
  constructor() { super({ createEngine, validateSize, closeFile, openFile }); }
}
