import type { DailyEntry, ToolRow } from './core';

export interface ColorMap {
  colorOf: (name: string) => string;
  top: string[];
  other: string;
}

export interface ShareSlice {
  name: string;
  tokens: number;
  color: string;
  pct: number; // 0-100
}

const SERIES_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
const MAX_SERIES = 6;

// One color assignment per tool for the whole page (share strip + chart),
// ranked by 30-day totals so it stays stable across range switches. Resolves
// the CSS custom properties to concrete colors for inline SVG fills.
export function buildColorMap(daily: DailyEntry[]): ColorMap {
  const css = getComputedStyle(document.documentElement);
  const totals: Record<string, number> = {};
  for (const d of daily) for (const [name, v] of Object.entries(d.byTool || {})) totals[name] = (totals[name] || 0) + v;
  const ranked = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const map = new Map<string, string>();
  ranked.slice(0, MAX_SERIES).forEach((name, i) => map.set(name, css.getPropertyValue(SERIES_VARS[i]).trim()));
  const other = css.getPropertyValue('--s-other').trim();
  return { colorOf: (name: string) => map.get(name) || other, top: ranked.slice(0, MAX_SERIES), other };
}

// Raw categorical palette (--s1..--s6), for widgets that color entries by
// position rather than by a stable tool-name mapping (e.g. the model bar list).
export function categoricalPalette(): string[] {
  const css = getComputedStyle(document.documentElement);
  return SERIES_VARS.map((v) => css.getPropertyValue(v).trim());
}

// Top 6 tools by tokens + an aggregated "Other" slice for the rest — shared by
// the token-share donut and (potentially) any future share-strip widget.
export function topSharesWithOther(byTool: ToolRow[], colors: ColorMap, max = MAX_SERIES): ShareSlice[] {
  const total = byTool.reduce((s, t) => s + t.tokens, 0);
  if (!total) return [];
  const sorted = [...byTool].sort((a, b) => b.tokens - a.tokens);
  const slices: ShareSlice[] = sorted.slice(0, max).map((t) => ({ name: t.name, tokens: t.tokens, color: colors.colorOf(t.name), pct: (t.tokens / total) * 100 }));
  const otherTokens = sorted.slice(max).reduce((s, t) => s + t.tokens, 0);
  if (otherTokens > 0) slices.push({ name: 'Other', tokens: otherTokens, color: colors.other, pct: (otherTokens / total) * 100 });
  return slices;
}
