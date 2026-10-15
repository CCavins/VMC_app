import { useSyncExternalStore } from 'react';
import { clipFromParsed, loadClip, parseModelFile, type ClipSource, type ParsedModelFile } from './animationClips';

export interface ClipEntry {
  id: string;
  name: string;
  /** URL (bundled or object URL). Omitted for clips created from an in-memory parse. */
  path?: string;
  source?: string;
  license?: string;
  uploaded?: boolean;
}

export interface ClipRecord {
  entry: ClipEntry;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  source?: ClipSource;
  enabled: boolean;
  /** Seconds, once loaded. */
  duration?: number;
}

type Listener = () => void;

/**
 * Registry of imported dance / motion clips shared by the UI and the retargeter.
 * Clips load asynchronously; `sources()` returns the enabled, ready ones.
 */
class ClipLibrary {
  private records: ClipRecord[] = [];
  private listeners = new Set<Listener>();
  private version = 0;

  snapshot(): ClipRecord[] { return this.records; }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    this.records = [...this.records];
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private update(id: string, patch: Partial<ClipRecord>) {
    const i = this.records.findIndex((r) => r.entry.id === id);
    if (i < 0) return;
    this.records[i] = { ...this.records[i], ...patch };
    this.emit();
  }

  has(id: string) { return this.records.some((r) => r.entry.id === id); }

  /** Register and start loading a clip from its URL. */
  add(entry: ClipEntry, enabled = true) {
    if (this.has(entry.id) || !entry.path) return;
    this.records.push({ entry, status: 'loading', enabled });
    this.emit();
    loadClip(entry.path, entry.id, entry.name)
      .then((source) => this.update(entry.id, { status: 'ready', source, duration: source.duration }))
      .catch((e: unknown) => this.update(entry.id, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
  }

  /** Register a clip from an already parsed file. */
  addParsed(parsed: ParsedModelFile, entry: ClipEntry, enabled = true) {
    if (this.has(entry.id)) return;
    try {
      const source = clipFromParsed(parsed, entry.id, entry.name);
      this.records.push({ entry, status: 'ready', source, enabled, duration: source.duration });
    } catch (e) {
      this.records.push({ entry, status: 'error', error: e instanceof Error ? e.message : String(e), enabled });
    }
    this.emit();
  }

  /** Import a user file (FBX / GLB with a humanoid animation). */
  async importFile(file: File) {
    const id = `clip-upload-${Date.now()}-${file.name}`;
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    this.records.push({ entry: { id, name, uploaded: true }, status: 'loading', enabled: true });
    this.emit();
    try {
      const parsed = await parseModelFile(file);
      const source = clipFromParsed(parsed, id, name);
      this.update(id, { status: 'ready', source, duration: source.duration });
    } catch (e) {
      this.update(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  setEnabled(id: string, enabled: boolean) { this.update(id, { enabled }); }

  remove(id: string) {
    const r = this.records.find((x) => x.entry.id === id);
    if (!r) return;
    r.source?.dispose();
    if (r.entry.uploaded && r.entry.path) URL.revokeObjectURL(r.entry.path);
    this.records = this.records.filter((x) => x.entry.id !== id);
    this.emit();
  }

  /** Enabled, loaded clip sources (stable identity until the library changes). */
  sources(): ClipSource[] {
    if (this.sourcesVersion !== this.version) {
      this.sourcesCache = this.records.filter((r) => r.enabled && r.status === 'ready' && r.source).map((r) => r.source!);
      this.sourcesVersion = this.version;
    }
    return this.sourcesCache;
  }
  private sourcesCache: ClipSource[] = [];
  private sourcesVersion = -1;
}

export const clipLibrary = new ClipLibrary();

export function useClipLibrary(): ClipRecord[] {
  return useSyncExternalStore(
    (fn) => clipLibrary.subscribe(fn),
    () => clipLibrary.snapshot(),
    () => clipLibrary.snapshot(),
  );
}
