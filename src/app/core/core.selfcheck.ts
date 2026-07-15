// Self-check for the pure aggregation core: `npm run test:core` (tsx). Excluded
// from the Angular build (tsconfig.app.json) — it uses node's assert.
import assert from 'node:assert';
import { aggregate, previousRangeFilters } from './core';

// aggregate() / rangeBounds() checks
const mkEntry = (cwd: string, ts: string, tokens: number) => ({
  mtimeMs: 1,
  turns: [
    {
      usage: { input_tokens: tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      model: 'claude-sonnet-4',
      tools: new Set<string>(),
      cwd,
      sessionId: 's-' + cwd,
      timestamp: new Date(ts).toISOString(),
      slug: 'slug',
      isSidechain: false,
    },
  ],
});
const NOW = new Date('2026-07-10T12:00:00Z').getTime();

const customRes = aggregate(
  [mkEntry('/a', '2026-07-01T00:00:00Z', 100), mkEntry('/a', '2026-07-09T00:00:00Z', 200)],
  { range: 'custom', from: '2026-07-08', to: '2026-07-09' },
  null,
  NOW,
).result;
assert.strictEqual(customRes.totals.tokens, 200, 'custom range keeps only turns inside from/to');

const swappedRes = aggregate(
  [mkEntry('/a', '2026-07-01T00:00:00Z', 100), mkEntry('/a', '2026-07-09T00:00:00Z', 200)],
  { range: 'custom', from: '2026-07-09', to: '2026-07-08' },
  null,
  NOW,
).result;
assert.strictEqual(swappedRes.totals.tokens, 200, 'from > to is swapped defensively');

const incompleteCustomRes = aggregate(
  [mkEntry('/a', '2026-07-01T00:00:00Z', 100)],
  { range: 'custom', from: '', to: '' },
  null,
  NOW,
).result;
assert.strictEqual(incompleteCustomRes.totals.tokens, 100, 'custom without complete dates falls back to all');

const noTs = {
  mtimeMs: 1,
  turns: [
    {
      usage: { input_tokens: 50, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      model: 'claude-sonnet-4',
      tools: new Set<string>(),
      cwd: '/a',
      sessionId: 's',
      timestamp: undefined,
      slug: 'slug',
      isSidechain: false,
    },
  ],
};
assert.strictEqual(aggregate([noTs], { range: 'all' }, null, NOW).result.totals.tokens, 50, 'missing-timestamp turn counted under unrestricted all range');
assert.strictEqual(aggregate([noTs], { range: 'today' }, null, NOW).result.totals.tokens, 0, 'missing-timestamp turn excluded under restricted range');

const twoProjects = [mkEntry('/a', '2026-07-09T00:00:00Z', 100), mkEntry('/b', '2026-07-09T00:00:00Z', 300)];
const filteredByProject = aggregate(twoProjects, { range: 'all', projects: ['/a'] }, null, NOW).result;
assert.strictEqual(filteredByProject.totals.tokens, 100, 'project filter restricts totals to that project');
assert.strictEqual(
  filteredByProject.daily.reduce((s, d) => s + d.tokens, 0),
  100,
  'project filter also restricts the daily chart',
);
assert.deepStrictEqual([...filteredByProject.projects].sort(), ['/a', '/b'], 'result.projects stays the full list even when a project filter is active');

const unfilteredDaily = aggregate([mkEntry('/a', '2026-07-01T00:00:00Z', 50), mkEntry('/a', '2026-07-09T00:00:00Z', 60)], { range: 'today' }, null, NOW).result;
assert.strictEqual(unfilteredDaily.daily.reduce((s, d) => s + d.tokens, 0), 110, 'date range filter does NOT restrict the daily chart');

const liveEntry = {
  mtimeMs: NOW - 1000,
  turns: [
    {
      usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      model: 'claude-sonnet-4',
      tools: new Set<string>(),
      cwd: '/a',
      sessionId: 's-a',
      timestamp: new Date(NOW - 1000).toISOString(),
      slug: 'slug',
      isSidechain: false,
    },
  ],
};
const liveMismatch = aggregate([liveEntry], { range: 'all', projects: ['/b'] }, null, NOW).result;
assert.strictEqual(liveMismatch.liveSession, null, 'liveSession nulled when filtered project does not match live session project');

const liveMatch = aggregate([liveEntry], { range: 'all', projects: ['/a'] }, null, NOW).result;
assert.ok(liveMatch.liveSession, 'liveSession present when filtered project matches live session project');

const threeProjects = [
  mkEntry('/a', '2026-07-09T00:00:00Z', 100),
  mkEntry('/b', '2026-07-09T00:00:00Z', 300),
  mkEntry('/c', '2026-07-09T00:00:00Z', 700),
];
const multiFiltered = aggregate(threeProjects, { range: 'all', projects: ['/a', '/b'] }, null, NOW).result;
assert.strictEqual(multiFiltered.totals.tokens, 400, 'multi-project filter includes all selected projects, excludes the rest');
assert.deepStrictEqual([...multiFiltered.projects].sort(), ['/a', '/b', '/c'], 'result.projects stays the full list with a multi-project filter active');

// previousRangeFilters() checks
assert.strictEqual(previousRangeFilters({ range: 'all' }, NOW), null, 'all time has no previous period');
assert.strictEqual(previousRangeFilters({ range: 'custom', from: '2026-07-01', to: '2026-07-05' }, NOW), null, 'custom range has no previous period');

const prevToday = previousRangeFilters({ range: 'today' }, NOW)!;
assert.strictEqual(prevToday.from, '2026-07-09', 'previous period for today is yesterday');
assert.strictEqual(prevToday.to, '2026-07-09', 'previous period for today is a single day');

const prev7d = previousRangeFilters({ range: '7d' }, NOW)!;
assert.strictEqual(prev7d.from, '2026-06-26', 'previous period for 7d starts 14 days back');
assert.strictEqual(prev7d.to, '2026-07-03', 'previous period for 7d ends 7 days back');

console.log('core.ts self-check: OK');
