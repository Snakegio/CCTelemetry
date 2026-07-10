import type { DailyEntry } from './core';

export interface ColorMap {
  colorOf: (name: string) => string;
  top: string[];
  other: string;
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
