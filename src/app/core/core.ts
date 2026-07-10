// Pure aggregation logic (ported from the old src/core.js). No DOM, no fs, no
// Tauri — usage.service.ts does the I/O and calls in here. Kept framework-free
// so core.selfcheck.ts can exercise it under `node`/tsx.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface Turn {
  usage: Usage;
  model?: string;
  tools: Set<string>;
  cwd: string;
  sessionId: string;
  timestamp?: string;
  slug?: string;
  isSidechain: boolean;
}

export interface FileEntry {
  turns: Turn[];
  mtimeMs: number;
}

export interface Filters {
  range?: string;
  projects?: string[];
  from?: string;
  to?: string;
}

export interface Totals {
  tokens: number;
  cost: number;
  costIncomplete: boolean;
}

export interface DrilldownRow {
  project: string;
  sessionId: string;
  tokens: number;
}

export interface ToolRow {
  name: string;
  tokens: number;
  cost: number;
  costIncomplete: boolean;
  calls: number;
  avgCost: number;
  drilldown: DrilldownRow[];
  isMcpGroup?: boolean;
  isSkillGroup?: boolean;
  children?: ToolRow[];
}

export interface ProjectRow {
  project: string;
  tokens: number;
  cost: number;
  costIncomplete: boolean;
}

export interface ModelRow {
  model: string;
  tokens: number;
  cost: number;
  costIncomplete: boolean;
}

export interface SessionRow {
  project: string;
  sessionId: string;
  label: string;
  tokens: number;
  cost: number;
  costIncomplete: boolean;
}

export interface DailyEntry {
  date: string;
  tokens: number;
  cost: number;
  costIncomplete: boolean;
  byTool: Record<string, number>;
}

export interface CacheEfficiency {
  fresh: number;
  cacheWrite: number;
  cacheRead: number;
  cacheReadPct: number;
}

export interface LiveSession {
  project: string;
  sessionId: string | null;
  tokens: number;
  tokensPerMinute: number;
  model: string | null;
  lastTool: string | null;
  contextTokens: number;
  contextWindow: number;
  contextLeftPct: number;
  sessionLeftPct: number | null;
  sessionResetAt: number | null;
}

export interface Subagents {
  tokens: number;
  cost: number;
  costIncomplete: boolean;
  pct: number;
}

export interface UsageResult {
  totals: Totals;
  byTool: ToolRow[];
  byProject: ProjectRow[];
  byModel: ModelRow[];
  cacheEfficiency: CacheEfficiency;
  daily: DailyEntry[];
  topSessions: SessionRow[];
  liveSession: LiveSession | null;
  subagents: Subagents;
  projects: string[];
}

export interface Suggestion {
  id: string;
  text: string;
}

interface PriceTier {
  key: string;
  match: RegExp;
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
}

// $ per MTok: input, output, cache write (5m TTL, 1.25x input), cache read (0.1x input)
// Fallback defaults if the daily price fetch (lib.rs) hasn't run yet or is failing.
export const PRICING: PriceTier[] = [
  { key: 'fable', match: /fable|mythos/i, in: 10, out: 50, cacheWrite: 12.5, cacheRead: 1 },
  { key: 'opus', match: /opus/i, in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { key: 'sonnet', match: /sonnet/i, in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { key: 'haiku', match: /haiku/i, in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
];

// cacheWrite/cacheRead are always 1.25x/0.1x the base input price, so a
// fetched {in, out} pair is enough to update a tier.
export function applyPriceOverrides(overrides: Record<string, { in?: number; out?: number }> | null | undefined): void {
  if (!overrides) return;
  for (const tier of PRICING) {
    const o = overrides[tier.key];
    if (!o || typeof o.in !== 'number' || typeof o.out !== 'number') continue;
    tier.in = o.in;
    tier.out = o.out;
    tier.cacheWrite = o.in * 1.25;
    tier.cacheRead = o.in * 0.1;
  }
}

export function pricingFor(model?: string | null): PriceTier | null {
  if (!model) return null;
  return PRICING.find((p) => p.match.test(model)) || null;
}

export function turnCost(turn: Turn): number | null {
  const tier = pricingFor(turn.model);
  if (!tier) return null;
  const u = turn.usage;
  return (
    ((u.input_tokens || 0) * tier.in +
      (u.output_tokens || 0) * tier.out +
      (u.cache_creation_input_tokens || 0) * tier.cacheWrite +
      (u.cache_read_input_tokens || 0) * tier.cacheRead) /
    1e6
  );
}

export function turnTokens(turn: Turn): number {
  const u = turn.usage;
  return (
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0)
  );
}

// Claude Code writes one JSONL line per content block of an assistant
// response, but duplicates the same `usage` on every line for that
// message.id - dedupe by id and merge the tool_use names across lines.
export function parseFileToTurns(raw: string): Turn[] {
  const turnsById = new Map<string, Turn>();
  const order: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;
    const id: string = msg.id || entry.uuid;
    let turn = turnsById.get(id);
    if (!turn) {
      turn = {
        usage: msg.usage,
        model: msg.model,
        tools: new Set<string>(),
        cwd: entry.cwd || 'unknown',
        sessionId: entry.sessionId || 'unknown',
        timestamp: entry.timestamp,
        slug: entry.slug,
        isSidechain: entry.isSidechain === true,
      };
      turnsById.set(id, turn);
      order.push(id);
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_use' || !block.name) continue;
        // group Skill invocations by which skill ran, not just "Skill"
        if (block.name === 'Skill' && block.input && block.input.skill) turn.tools.add('skill__' + block.input.skill);
        else turn.tools.add(block.name);
      }
    }
  }
  return order.map((id) => turnsById.get(id)!);
}

interface Bounds {
  lower: number;
  upper: number;
}

function rangeBounds(filters: Filters, now: number): Bounds {
  const range = filters.range;
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { lower: d.getTime(), upper: Infinity };
  }
  if (range === '30d') return { lower: now - 30 * 24 * 3600 * 1000, upper: Infinity };
  if (range === 'custom' && filters.from && filters.to) {
    let from = filters.from;
    let to = filters.to;
    if (from > to) [from, to] = [to, from];
    const lower = new Date(from + 'T00:00:00').getTime();
    const upper = new Date(to + 'T23:59:59.999').getTime();
    return { lower, upper };
  }
  return { lower: 0, upper: Infinity }; // 'all' (or incomplete 'custom')
}

function localDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucket<T>(map: Map<string, T>, key: string, init: () => T): T {
  let b = map.get(key);
  if (!b) {
    b = init();
    map.set(key, b);
  }
  return b;
}

const CONTEXT_WINDOWS = [{ match: /haiku/i, size: 200000 }];
function contextWindowFor(model?: string | null): number {
  const hit = CONTEXT_WINDOWS.find((c) => c.match.test(model || ''));
  return hit ? hit.size : 1000000;
}

// Claude Code rate limits reset on a rolling 5-hour window (account-wide).
// Mirrors ccusage block logic: a block starts at the first activity floored
// to the hour and ends 5h later or after a >5h gap of inactivity.
const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
function floorToHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}
function currentSessionBlock(allTurns: Turn[], _now: number): { start: number; lastActivity: number; resetAt: number } | null {
  const times = allTurns
    .filter((t) => t.timestamp)
    .map((t) => new Date(t.timestamp as string).getTime())
    .sort((a, b) => a - b);
  if (!times.length) return null;
  let start = floorToHour(times[0]);
  let last = times[0];
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    if (t - start > SESSION_WINDOW_MS || t - last > SESSION_WINDOW_MS) {
      start = floorToHour(t);
    }
    last = t;
  }
  return { start, lastActivity: last, resetAt: start + SESSION_WINDOW_MS };
}

// logs can only shrink (cleanup), so the larger figure per day is the truer one
export function mergeDaily(
  stored: Record<string, DailyEntry>,
  dailyEntries: DailyEntry[],
): { merged: Record<string, DailyEntry>; changed: boolean } {
  let changed = false;
  for (const entry of dailyEntries) {
    if (!stored[entry.date] || entry.tokens >= stored[entry.date].tokens) {
      if (!stored[entry.date] || JSON.stringify(stored[entry.date]) !== JSON.stringify(entry)) changed = true;
      stored[entry.date] = entry;
    }
  }
  return { merged: stored, changed };
}

interface ToolBucket {
  tokens: number;
  cost: number;
  costIncomplete: boolean;
  calls: number;
  drilldown: Map<string, DrilldownRow>;
  children?: Map<string, ToolBucket>;
}

// fileEntries: [{turns, mtimeMs}] — all parsed session files.
// storedHistory: object date->entry (mutated via mergeDaily) or null.
export function aggregate(
  fileEntries: FileEntry[],
  filters: Filters = {},
  storedHistory: Record<string, DailyEntry> | null = null,
  now: number = Date.now(),
): { result: UsageResult; historyChanged: boolean } {
  const bounds = rangeBounds(filters, now);

  let newestMtime = 0;
  let newestEntry: FileEntry | null = null;
  const allTurns: Turn[] = [];
  for (const fe of fileEntries) {
    allTurns.push(...fe.turns);
    if (fe.mtimeMs > newestMtime) {
      newestMtime = fe.mtimeMs;
      newestEntry = fe;
    }
  }

  const totals: Totals = { tokens: 0, cost: 0, costIncomplete: false };
  const toolBuckets = new Map<string, ToolBucket>();
  const mcpServers = new Map<string, ToolBucket>();
  const skillGroup: ToolBucket = { tokens: 0, cost: 0, costIncomplete: false, calls: 0, drilldown: new Map(), children: new Map() };
  const projectBuckets = new Map<string, ProjectRow>();
  const modelBuckets = new Map<string, ModelRow>();
  const sessionBuckets = new Map<string, SessionRow>();
  const dailyBuckets = new Map<string, DailyEntry>();
  const projectsSeen = new Set<string>();
  const cacheEff = { fresh: 0, cacheWrite: 0, cacheRead: 0 };
  const subagents = { tokens: 0, cost: 0, costIncomplete: false };

  function newBucket(): ToolBucket {
    return { tokens: 0, cost: 0, costIncomplete: false, calls: 0, drilldown: new Map() };
  }
  function addDrilldown(b: ToolBucket, project: string, sessionId: string, tokens: number): void {
    const key = project + ' ' + sessionId;
    const d = bucket(b.drilldown, key, () => ({ project, sessionId, tokens: 0 }));
    d.tokens += tokens;
  }
  function addToBucket(b: ToolBucket, tokens: number, cost: number | null, project: string, sessionId: string): void {
    b.tokens += tokens;
    b.calls += 1;
    if (cost === null) b.costIncomplete = true;
    else b.cost += cost;
    addDrilldown(b, project, sessionId, tokens);
  }

  for (const turn of allTurns) {
    const tokens = turnTokens(turn);
    const cost = turnCost(turn);
    const projectFilter = Array.isArray(filters.projects) && filters.projects.length ? filters.projects : null;

    const toolNames = turn.tools.size ? [...turn.tools] : ['(direct response)'];
    const share = tokens / toolNames.length;
    const shareCost = cost === null ? null : cost / toolNames.length;
    const groupName = (name: string): string => {
      if (name.startsWith('mcp__')) return `MCP: ${name.split('__')[1] || 'unknown'}`;
      if (name.startsWith('skill__')) return 'Skill';
      return name;
    };

    // daily chart is always the last-30-days view, independent of the range filter,
    // but DOES respect the project filter — see Part A of the design spec
    if (turn.timestamp && (!projectFilter || projectFilter.includes(turn.cwd))) {
      const day = localDate(turn.timestamp);
      const d = bucket(dailyBuckets, day, () => ({ date: day, tokens: 0, cost: 0, costIncomplete: false, byTool: {} as Record<string, number> }));
      d.tokens += tokens;
      if (cost === null) d.costIncomplete = true;
      else d.cost += cost;
      for (const name of toolNames) {
        const g = groupName(name);
        d.byTool[g] = (d.byTool[g] || 0) + share;
      }
    }

    // everything below respects the range filter
    if (turn.timestamp) {
      const ts = new Date(turn.timestamp).getTime();
      if (ts < bounds.lower || ts > bounds.upper) continue;
    } else if (bounds.lower !== 0 || bounds.upper !== Infinity) {
      continue;
    }

    projectsSeen.add(turn.cwd);
    if (projectFilter && !projectFilter.includes(turn.cwd)) continue;

    totals.tokens += tokens;
    if (cost === null) totals.costIncomplete = true;
    else totals.cost += cost;

    if (turn.isSidechain) {
      subagents.tokens += tokens;
      if (cost === null) subagents.costIncomplete = true;
      else subagents.cost += cost;
    }

    cacheEff.fresh += turn.usage.input_tokens || 0;
    cacheEff.cacheWrite += turn.usage.cache_creation_input_tokens || 0;
    cacheEff.cacheRead += turn.usage.cache_read_input_tokens || 0;

    for (const name of toolNames) {
      if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const server = parts[1] || 'unknown';
        const toolName = parts.slice(2).join('__') || name;
        const serverBucket = bucket(mcpServers, server, () => ({ ...newBucket(), children: new Map<string, ToolBucket>() }));
        addToBucket(serverBucket, share, shareCost, turn.cwd, turn.sessionId);
        const childBucket = bucket(serverBucket.children!, toolName, newBucket);
        addToBucket(childBucket, share, shareCost, turn.cwd, turn.sessionId);
      } else if (name.startsWith('skill__')) {
        const skillName = name.slice('skill__'.length) || 'unknown';
        addToBucket(skillGroup, share, shareCost, turn.cwd, turn.sessionId);
        const childBucket = bucket(skillGroup.children!, skillName, newBucket);
        addToBucket(childBucket, share, shareCost, turn.cwd, turn.sessionId);
      } else {
        const b = bucket(toolBuckets, name, newBucket);
        addToBucket(b, share, shareCost, turn.cwd, turn.sessionId);
      }
    }

    const proj = bucket(projectBuckets, turn.cwd, () => ({ project: turn.cwd, tokens: 0, cost: 0, costIncomplete: false }));
    proj.tokens += tokens;
    if (cost === null) proj.costIncomplete = true;
    else proj.cost += cost;

    const modelName = turn.model || 'unknown';
    const mod = bucket(modelBuckets, modelName, () => ({ model: modelName, tokens: 0, cost: 0, costIncomplete: false }));
    mod.tokens += tokens;
    if (cost === null) mod.costIncomplete = true;
    else mod.cost += cost;

    const sess = bucket(sessionBuckets, turn.sessionId, () => ({
      project: turn.cwd,
      sessionId: turn.sessionId,
      label: turn.slug || turn.sessionId,
      tokens: 0,
      cost: 0,
      costIncomplete: false,
    }));
    sess.tokens += tokens;
    if (cost === null) sess.costIncomplete = true;
    else sess.cost += cost;
  }

  function serializeDrilldown(map: Map<string, DrilldownRow>): DrilldownRow[] {
    return [...map.values()].sort((a, b) => b.tokens - a.tokens);
  }
  function serializeToolBucket(name: string, b: ToolBucket): ToolRow {
    return {
      name,
      tokens: b.tokens,
      cost: b.cost,
      costIncomplete: b.costIncomplete,
      calls: b.calls,
      avgCost: b.calls ? b.cost / b.calls : 0,
      drilldown: serializeDrilldown(b.drilldown),
    };
  }

  const byTool: ToolRow[] = [
    ...[...toolBuckets.entries()].map(([name, b]) => serializeToolBucket(name, b)),
    ...[...mcpServers.entries()].map(([server, b]) => ({
      ...serializeToolBucket(`MCP: ${server}`, b),
      isMcpGroup: true,
      children: [...b.children!.entries()]
        .map(([toolName, cb]) => serializeToolBucket(toolName, cb))
        .sort((a, c) => c.tokens - a.tokens),
    })),
    ...(skillGroup.calls
      ? [
          {
            ...serializeToolBucket('Skill', skillGroup),
            isSkillGroup: true,
            children: [...skillGroup.children!.entries()]
              .map(([skillName, cb]) => serializeToolBucket(skillName, cb))
              .sort((a, c) => c.tokens - a.tokens),
          },
        ]
      : []),
  ].sort((a, b) => b.tokens - a.tokens);

  const byProject = [...projectBuckets.values()].sort((a, b) => b.tokens - a.tokens);

  const byModel = [...modelBuckets.values()].sort((a, b) => b.tokens - a.tokens);

  const topSessions = [...sessionBuckets.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

  let historyChanged = false;
  let dailyEntries = [...dailyBuckets.values()];
  if (storedHistory) {
    const res = mergeDaily(storedHistory, dailyEntries);
    dailyEntries = Object.values(res.merged);
    historyChanged = res.changed;
  }
  const daily = dailyEntries.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-30);

  const cacheTotal = cacheEff.fresh + cacheEff.cacheWrite + cacheEff.cacheRead;
  const cacheEfficiency: CacheEfficiency = {
    ...cacheEff,
    cacheReadPct: cacheTotal ? (cacheEff.cacheRead / cacheTotal) * 100 : 0,
  };

  let liveSession: LiveSession | null = null;
  const LIVE_WINDOW_MS = 2 * 60 * 1000;
  const projectFilterForLive = Array.isArray(filters.projects) && filters.projects.length ? filters.projects : null;
  if (newestEntry && now - newestMtime <= LIVE_WINDOW_MS) {
    const turns = newestEntry.turns;
    const sessionId = turns.length ? turns[turns.length - 1].sessionId : null;
    const sessionTurns = turns.filter((t) => t.sessionId === sessionId);
    const last = sessionTurns[sessionTurns.length - 1];
    const recentCutoff = now - 60 * 1000;
    const recentTokens = sessionTurns
      .filter((t) => t.timestamp && new Date(t.timestamp).getTime() >= recentCutoff)
      .reduce((sum, t) => sum + turnTokens(t), 0);
    // last turn's input + cache tokens ≈ what the context window currently holds
    const u = last ? last.usage : null;
    const contextTokens = u
      ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      : 0;
    const contextWindow = contextWindowFor(last ? last.model : null);
    const block = currentSessionBlock(allTurns, now);
    let sessionLeftPct: number | null = null;
    let sessionResetAt: number | null = null;
    if (block) {
      sessionResetAt = block.resetAt;
      sessionLeftPct = Math.max(0, Math.min(100, ((block.resetAt - now) / SESSION_WINDOW_MS) * 100));
    }
    const liveProject = last ? last.cwd : 'unknown';
    if (!projectFilterForLive || projectFilterForLive.includes(liveProject)) {
      liveSession = {
        project: liveProject,
        sessionId,
        tokens: sessionTurns.reduce((sum, t) => sum + turnTokens(t), 0),
        tokensPerMinute: recentTokens,
        model: last ? last.model ?? null : null,
        lastTool: last && last.tools.size ? [...last.tools][last.tools.size - 1] : null,
        contextTokens,
        contextWindow,
        contextLeftPct: Math.max(0, Math.min(100, (1 - contextTokens / contextWindow) * 100)),
        sessionLeftPct,
        sessionResetAt,
      };
    }
  }

  const subagentsOut: Subagents = {
    ...subagents,
    pct: totals.tokens ? (subagents.tokens / totals.tokens) * 100 : 0,
  };

  const projects = [...projectsSeen].sort();
  return {
    result: { totals, byTool, byProject, byModel, cacheEfficiency, daily, topSessions, liveSession, subagents: subagentsOut, projects },
    historyChanged,
  };
}

export function summaryLine(d: UsageResult): string {
  const fmt = (n: number): string =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
  const parts = [`${fmt(d.totals.tokens)} tok`, `$${d.totals.cost.toFixed(2)}`];
  if (d.liveSession && d.liveSession.sessionLeftPct != null) parts.push(`session ${Math.round(d.liveSession.sessionLeftPct)}% left`);
  return parts.join(' · ');
}

// Simple heuristic rules over the aggregate() output. Each rule is a fixed
// threshold, not a model of "ideal" usage — tune the numbers below if they
// fire too often/rarely on real data.
// ponytail: hardcoded thresholds, revisit if users report noisy/missing suggestions
export function suggestions(d: UsageResult): Suggestion[] {
  const out: Suggestion[] = [];
  const totalTokens = d.totals.tokens;
  if (!totalTokens || totalTokens < 10000) return out; // too little data to say anything useful

  if (d.cacheEfficiency.cacheReadPct < 20) {
    out.push({
      id: 'cache-low',
      text: `Solo il ${d.cacheEfficiency.cacheReadPct.toFixed(0)}% dei token proviene dalla cache. Riutilizzare lo stesso contesto tra richieste ravvicinate nella stessa sessione riduce il costo per token.`,
    });
  }

  for (const m of d.byModel) {
    if (!m.tokens || m.costIncomplete || !d.totals.cost) continue;
    const tokenShare = m.tokens / totalTokens;
    const costShare = m.cost / d.totals.cost;
    if (tokenShare > 0.05 && costShare - tokenShare > 0.25) {
      out.push({
        id: 'model-skew-' + m.model,
        text: `"${m.model}" genera il ${(costShare * 100).toFixed(0)}% della spesa ma solo il ${(tokenShare * 100).toFixed(0)}% dei token. Se molte di queste richieste sono task semplici, prova un modello più economico.`,
      });
    }
  }

  for (const t of d.byTool) {
    const share = t.tokens / totalTokens;
    if (share > 0.35) {
      out.push({
        id: 'tool-dominant-' + t.name,
        text: `"${t.name}" da solo genera il ${(share * 100).toFixed(0)}% dei token totali. Se viene invocato più spesso del necessario, valuta di limitarne l'uso.`,
      });
    }
  }

  if (d.subagents.pct > 30) {
    out.push({
      id: 'subagents-heavy',
      text: `Il ${d.subagents.pct.toFixed(0)}% dei token viene da sottoagenti. Se i loro task sono ripetitivi, valuta di accorpare le richieste invece di dispatchare tanti agenti paralleli.`,
    });
  }

  if (d.liveSession && d.liveSession.contextLeftPct < 10) {
    out.push({
      id: 'context-full',
      text: `La sessione attiva usa il ${(100 - d.liveSession.contextLeftPct).toFixed(0)}% della finestra di contesto. Avviare una nuova sessione ora evita rigenerazioni costose.`,
    });
  }

  if (d.daily.length >= 6) {
    const todayEntry = d.daily[d.daily.length - 1];
    const prior = d.daily.slice(-7, -1);
    const priorAvg = prior.reduce((sum, e) => sum + e.cost, 0) / prior.length;
    if (priorAvg > 0 && todayEntry.cost > priorAvg * 2.5) {
      out.push({
        id: 'daily-spike',
        text: `Il consumo di oggi è circa ${(todayEntry.cost / priorAvg).toFixed(1)}x la media degli ultimi giorni. Controlla se è previsto o se un tool sta girando fuori controllo.`,
      });
    }
  }

  return out;
}
