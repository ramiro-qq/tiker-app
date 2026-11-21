import type { LibraryNode } from '../features/library/model.ts';
import type { LearningStore } from '../features/learning/model.ts';

export interface ContentSnapshot {
  libraryId: string;
  revision: number;
  library: LibraryNode[];
  learning: LearningStore;
}
export type Collection = 'library' | 'learning';
export type CollectionValue = LibraryNode[] | LearningStore;
export interface ContentOperation { collection: Collection; base: CollectionValue; next: CollectionValue }
export interface ContentState { data: ContentSnapshot; pending: number; error: string; remoteGeneration: number }
interface Persistence {
  save: (collection: Collection, base: CollectionValue, next: CollectionValue) => Promise<ContentSnapshot>;
  journal: (operations: ContentOperation[]) => void;
}
const errorText = (error: unknown) => typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);

// Durable recovery journal is written before accepting an edit. Backend remains the source of truth.
export class ContentQueue {
  private state: ContentState;
  private operations: ContentOperation[];
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private io: Persistence;
  constructor(initial: ContentSnapshot, io: Persistence, recovered: ContentOperation[] = []) {
    this.io = io;
    this.operations = structuredClone(recovered);
    let data = structuredClone(initial);
    for (const op of recovered) data = { ...data, [op.collection]: structuredClone(op.next) };
    this.state = { data, pending: recovered.length, error: '', remoteGeneration: 0 };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ContentState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  write(collection: Collection, next: CollectionValue) {
    if (JSON.stringify(this.state.data[collection]) === JSON.stringify(next)) return;
    const op = { collection, base: structuredClone(this.state.data[collection]), next: structuredClone(next) };
    const operations = [...this.operations, op];
    this.io.journal(operations);
    this.operations = operations;
    this.update({ data: { ...this.state.data, [collection]: structuredClone(next) }, pending: operations.length });
    if (!this.state.error) this.start();
  }
  private start() {
    if (this.running) return;
    this.running = this.drain().finally(() => { this.running = null; });
  }
  private async drain() {
    while (this.operations.length) {
      const op = this.operations[0];
      try {
        const saved = await this.io.save(op.collection, op.base, op.next);
        const remaining = this.operations.slice(1);
        this.io.journal(remaining);
        this.operations = remaining;
        this.update({ data: remaining.length ? { ...this.state.data, revision: saved.revision } : saved, pending: remaining.length, error: '' });
      } catch (error) {
        this.update({ error: errorText(error), pending: this.operations.length });
        return;
      }
    }
  }
  async flush() {
    if (this.operations.length && !this.state.error) this.start();
    await this.running;
    if (this.state.error) throw new Error(this.state.error);
  }
  async retry() {
    await this.running;
    this.update({ error: '' });
    this.start();
    await this.flush();
  }
  acceptRemote(data: ContentSnapshot) {
    if (this.operations.length || data.libraryId !== this.state.data.libraryId || data.revision < this.state.data.revision) return false;
    if (JSON.stringify(data) !== JSON.stringify(this.state.data)) {
      this.update({ data, remoteGeneration: this.state.remoteGeneration + 1 });
    }
    return true;
  }
}
