// Deeper, category-focused rules on top of aggregate() output — a companion
// to suggestions() in core.ts, kept in its own file so core.ts doesn't keep
// growing with interpretation logic on top of aggregation logic.
import { basename } from './format';
import { pricingFor, type UsageResult } from './core';

export type FindingCategory = 'model' | 'cache' | 'tool-pattern' | 'anomaly';

export interface Finding {
  id: string;
  category: FindingCategory;
  metric: string; // big number, e.g. "62%", "8x", "6.2x"
  metricLabel: string; // caption under the metric, e.g. "direct-response"
  title: string; // bold line, e.g. the model/project/tool name
  detail: string; // the "why" — secondary description line
  action: string; // the "what to do" — concrete Claude Code action
  impactTokens: number; // measured weight in tokens, for ranking + display
}

// ponytail: hardcoded thresholds, tune if they fire too often/rarely on real data
export function analyzeUsage(d: UsageResult): Finding[] {
  if (!d.totals.tokens || d.totals.tokens < 10000) return []; // too little data to say anything useful
  return [...analyzeModelChoice(d), ...analyzeCacheUsage(d), ...analyzeToolPatterns(d), ...analyzeAnomalies(d)].sort(
    (a, b) => b.impactTokens - a.impactTokens,
  );
}

function analyzeModelChoice(d: UsageResult): Finding[] {
  const out: Finding[] = [];
  const totalTokens = d.totals.tokens;
  for (const m of d.byModel) {
    if (!m.tokens) continue;
    const tier = pricingFor(m.model);
    if (!tier || tier.in < 5) continue; // only flag the expensive tiers (opus/fable)
    if (m.tokens / totalTokens < 0.05) continue; // too small a slice of overall usage to matter
    const directPct = (m.directResponseTokens / m.tokens) * 100;
    if (directPct > 40) {
      out.push({
        id: 'model-direct-response-' + m.model,
        category: 'model',
        metric: `${directPct.toFixed(0)}%`,
        metricLabel: 'direct-response',
        title: m.model,
        detail: 'of its tokens come from turns with no tool use — tasks a cheaper model often handles just as well.',
        action: 'Route plain Q&A to a cheaper model — /model sonnet — and keep Opus for the hard tasks.',
        impactTokens: m.directResponseTokens,
      });
    }
  }
  return out;
}

function analyzeCacheUsage(d: UsageResult): Finding[] {
  const out: Finding[] = [];
  for (const p of d.byProject) {
    if (p.tokens < 10000) continue; // too little data for this project
    if (p.cacheReadPct < 10) {
      out.push({
        id: 'cache-low-project-' + p.project,
        category: 'cache',
        metric: `${p.cacheReadPct.toFixed(0)}%`,
        metricLabel: 'cache reuse',
        title: basename(p.project),
        detail: "Cache is reused for very little of this project's input, so most of it pays full price.",
        action: 'Keep a stable CLAUDE.md and avoid /clear mid-task so the cached prompt prefix gets reused.',
        impactTokens: p.nonCachedInputTokens,
      });
    }
  }
  return out;
}

function analyzeToolPatterns(d: UsageResult): Finding[] {
  return d.toolStreaks.slice(0, 5).map((s) => ({
    id: `tool-streak-${s.sessionId}-${s.tool}`,
    category: 'tool-pattern' as const,
    metric: `${s.count}x`,
    metricLabel: 'in a row',
    title: s.tool,
    detail: `called back-to-back in session "${s.label}" (project ${basename(s.project)}).`,
    action: `Batch these ${s.tool} calls or reuse the result instead of repeating them.`,
    impactTokens: s.tokens,
  }));
}

function analyzeAnomalies(d: UsageResult): Finding[] {
  const out: Finding[] = [];
  if (!d.medianSessionCost) return out;
  for (const s of d.topSessions.slice(0, 3)) {
    const ratio = s.cost / d.medianSessionCost;
    if (ratio > 5) {
      out.push({
        id: 'anomaly-session-' + s.sessionId,
        category: 'anomaly',
        metric: `${ratio.toFixed(1)}x`,
        metricLabel: 'vs. median session',
        title: s.label,
        detail: `project ${basename(s.project)} — this one session ran far above your typical cost.`,
        action: 'Long/expensive session — use /compact to shrink the context, or start a fresh session sooner.',
        impactTokens: s.tokens,
      });
    }
  }
  return out;
}
