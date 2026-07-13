import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  aggregate,
  applyPriceOverrides,
  parseFileToTurns,
  previousRangeFilters,
  type DailyEntry,
  type FileEntry,
  type Filters,
  type Turn,
  type UsageResult,
} from '../core/core';

// Shapes returned by the Rust commands (see src-tauri/src/commands.rs). serde
// keeps field names as-is, hence mtime_ms.
interface FileMeta {
  path: string;
  mtime_ms: number;
  size: number;
}
interface FileContent {
  path: string;
  content: string;
}

// Comparison figures for the KPI tile deltas — only present when the active
// range has an unambiguous previous period (see previousRangeFilters()).
export type PreviousPeriod = Pick<UsageResult, 'totals' | 'cacheEfficiency' | 'subagents'>;

export type Usage = UsageResult & { claudeNotFound: boolean; previous: PreviousPeriod | null };

// Reads ~/.claude/projects through Rust commands, runs the shared aggregation
// core, and persists daily history. Replaces the old tauri-provider.js — same
// orchestration, but every filesystem touch is a #[tauri::command] invoke now.
@Injectable({ providedIn: 'root' })
export class UsageService {
  private fileCache = new Map<string, { mtime: number; size: number; turns: Turn[] }>();
  private storedHistory: Record<string, DailyEntry> | null = null;
  private lastSavedHistory = '';
  private lastPricingRaw = '';

  private async loadHistory(): Promise<void> {
    if (this.storedHistory !== null) return;
    try {
      this.storedHistory = JSON.parse(await invoke<string>('read_history'));
    } catch {
      this.storedHistory = {};
    }
    this.lastSavedHistory = JSON.stringify(this.storedHistory);
  }

  private async saveHistory(): Promise<void> {
    const s = JSON.stringify(this.storedHistory);
    if (s === this.lastSavedHistory) return;
    try {
      await invoke('write_history', { json: s });
      this.lastSavedHistory = s;
    } catch {
      // best-effort persistence; retry on the next poll
    }
  }

  private async applyCachedPricing(): Promise<void> {
    let payload: { prices?: Record<string, { in?: number; out?: number }> } | null;
    try {
      payload = await invoke<typeof payload>('get_pricing');
    } catch {
      return;
    }
    if (!payload) return;
    const raw = JSON.stringify(payload);
    if (raw === this.lastPricingRaw) return;
    this.lastPricingRaw = raw;
    applyPriceOverrides(payload.prices);
  }

  async getUsage(filters: Filters): Promise<Usage> {
    await this.loadHistory();
    await this.applyCachedPricing();
    const claudeNotFound = !(await invoke<boolean>('claude_exists').catch(() => false));

    const metas = await invoke<FileMeta[]>('list_sessions');

    // Only re-read (and re-parse) files whose mtime/size changed — same
    // optimization the old provider did, now across the invoke boundary.
    const changed = metas.filter((m) => {
      const c = this.fileCache.get(m.path);
      return !c || c.mtime !== m.mtime_ms || c.size !== m.size;
    });
    if (changed.length) {
      const contents = await invoke<FileContent[]>('read_sessions', { paths: changed.map((m) => m.path) });
      const byPath = new Map(contents.map((c) => [c.path, c.content]));
      for (const m of changed) {
        const turns = parseFileToTurns(byPath.get(m.path) ?? '');
        this.fileCache.set(m.path, { mtime: m.mtime_ms, size: m.size, turns });
      }
    }

    const entries: FileEntry[] = [];
    const live = new Set(metas.map((m) => m.path));
    for (const m of metas) {
      const c = this.fileCache.get(m.path);
      if (c) entries.push({ turns: c.turns, mtimeMs: m.mtime_ms });
    }
    // drop cache entries for files that no longer exist
    for (const path of [...this.fileCache.keys()]) if (!live.has(path)) this.fileCache.delete(path);

    const { result, historyChanged } = aggregate(entries, filters, this.storedHistory);
    if (historyChanged) await this.saveHistory();

    const prevFilters = previousRangeFilters(filters);
    const previous = prevFilters ? aggregate(entries, prevFilters, this.storedHistory).result : null;

    return { ...result, claudeNotFound, previous };
  }
}
