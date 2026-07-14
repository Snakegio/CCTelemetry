// Self-check for the deep-analysis rules: `npm run test:core` (tsx). Excluded
// from the Angular build (tsconfig.app.json) — it uses node's assert.
import assert from 'node:assert';
import { analyzeUsage, type Finding } from './analysis';
import type { UsageResult } from './core';

// analyzeUsage() accepts partial shapes here; cast since these are hand-built.
const run = (d: unknown): Finding[] => analyzeUsage(d as UsageResult);

const base = {
  totals: { tokens: 100000, cost: 10, costIncomplete: false },
  byModel: [],
  byProject: [],
  toolStreaks: [],
  topSessions: [],
  medianSessionCost: 0,
};

assert.deepStrictEqual(run({ ...base, totals: { tokens: 500, cost: 0.1 } }), [], 'too little data → no findings');

const modelDirect = run({
  ...base,
  byModel: [{ model: 'claude-opus', tokens: 20000, cost: 15, costIncomplete: false, directResponseTokens: 12000 }],
});
const modelFinding = modelDirect.find((f) => f.id === 'model-direct-response-claude-opus');
assert.ok(modelFinding, 'opus-heavy direct-response turns trigger model finding');
assert.strictEqual(modelFinding!.metric, '60%', 'model finding metric is the direct-response share');
assert.strictEqual(modelFinding!.title, 'claude-opus', 'model finding title is the model name');
assert.strictEqual(modelFinding!.impactTokens, 12000, 'model finding impact is the direct-response token count');
assert.ok(modelFinding!.action.length > 0, 'model finding carries a recommended action');

const modelToolHeavy = run({
  ...base,
  byModel: [{ model: 'claude-opus', tokens: 20000, cost: 15, costIncomplete: false, directResponseTokens: 1000 }],
});
assert.ok(!modelToolHeavy.some((f) => f.category === 'model'), 'mostly tool-using opus usage does not trigger model finding');

const cacheLow = run({
  ...base,
  byProject: [{ project: '/a', tokens: 20000, cost: 5, costIncomplete: false, cacheReadPct: 3, nonCachedInputTokens: 14000 }],
});
const cacheFinding = cacheLow.find((f) => f.id === 'cache-low-project-/a');
assert.ok(cacheFinding, 'structurally low per-project cache read triggers cache finding');
assert.strictEqual(cacheFinding!.metric, '3%', 'cache finding metric is the cache-read percentage');
assert.strictEqual(cacheFinding!.impactTokens, 14000, 'cache finding impact is the non-cached input token count');
assert.ok(cacheFinding!.action.length > 0, 'cache finding carries a recommended action');

const toolPattern = run({
  ...base,
  toolStreaks: [{ sessionId: 's1', project: '/a', label: 'fix-auth-bug', tool: 'Read', count: 8, tokens: 9000 }],
});
const toolFinding = toolPattern.find((f) => f.id === 'tool-streak-s1-Read');
assert.ok(toolFinding, 'repeated tool streak surfaces as tool-pattern finding');
assert.strictEqual(toolFinding!.metric, '8x', 'tool-pattern finding metric is the streak length');
assert.strictEqual(toolFinding!.impactTokens, 9000, 'tool-pattern finding impact is the streak token count');
assert.ok(toolFinding!.detail.includes('fix-auth-bug'), 'tool-pattern finding detail references the session label');
assert.ok(toolFinding!.action.includes('Read'), 'tool-pattern finding action references the repeated tool');

const anomaly = run({
  ...base,
  medianSessionCost: 1,
  topSessions: [{ project: '/a', sessionId: 's-big', label: 'big', tokens: 50000, cost: 10, costIncomplete: false }],
});
const anomalyFinding = anomaly.find((f) => f.id === 'anomaly-session-s-big');
assert.ok(anomalyFinding, 'session costing far above the median triggers anomaly finding');
assert.strictEqual(anomalyFinding!.metric, '10.0x', 'anomaly finding metric is the cost ratio vs. the median session');
assert.strictEqual(anomalyFinding!.title, 'big', 'anomaly finding title is the session label');

const anomalyFindingImpact = anomaly.find((f) => f.id === 'anomaly-session-s-big');
assert.strictEqual(anomalyFindingImpact!.impactTokens, 50000, 'anomaly finding impact is the session token count');

const noAnomaly = run({
  ...base,
  medianSessionCost: 8,
  topSessions: [{ project: '/a', sessionId: 's-normal', label: 'normal', tokens: 50000, cost: 10, costIncomplete: false }],
});
assert.ok(!noAnomaly.some((f) => f.category === 'anomaly'), 'session close to the median does not trigger anomaly finding');

// findings from different rules come back ranked by measured impact (tokens) desc
const ranked = run({
  ...base,
  byModel: [{ model: 'claude-opus', tokens: 20000, cost: 15, costIncomplete: false, directResponseTokens: 12000 }],
  byProject: [{ project: '/a', tokens: 20000, cost: 5, costIncomplete: false, cacheReadPct: 3, nonCachedInputTokens: 90000 }],
  medianSessionCost: 1,
  topSessions: [{ project: '/a', sessionId: 's-big', label: 'big', tokens: 40000, cost: 10, costIncomplete: false }],
});
const impacts = ranked.map((f) => f.impactTokens);
assert.deepStrictEqual(impacts, [...impacts].sort((a, b) => b - a), 'findings are ranked by impactTokens desc');
assert.strictEqual(ranked[0].category, 'cache', 'the highest-impact finding (90k) leads the list');

console.log('analysis.ts self-check: OK');
