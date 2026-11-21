// Each session owns a turn. Aborting invalidates it before any replacement starts.
export class SessionRuns {
  private turns = new Map<string, AbortController>();
  begin(sessionId: string): AbortSignal | null {
    if (this.turns.has(sessionId)) return null;
    const controller = new AbortController();
    this.turns.set(sessionId, controller);
    return controller.signal;
  }
  has(sessionId: string) {
    return this.turns.has(sessionId);
  }
  isCurrent(sessionId: string, signal: AbortSignal) {
    return !signal.aborted && this.turns.get(sessionId)?.signal === signal;
  }
  interrupt(sessionId: string) {
    const controller = this.turns.get(sessionId);
    this.turns.delete(sessionId);
    controller?.abort();
  }
  interruptAll() {
    for (const id of this.turns.keys()) this.interrupt(id);
  }
  finish(sessionId: string, signal: AbortSignal) {
    if (!this.isCurrent(sessionId, signal)) return false;
    this.turns.delete(sessionId);
    return true;
  }
}
