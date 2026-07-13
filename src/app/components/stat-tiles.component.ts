import { Component, computed, input } from '@angular/core';
import { CardModule } from 'primeng/card';
import type { Usage } from '../services/usage.service';
import { fmtCost, fmtExact, fmtTokens } from '../core/format';

interface Delta {
  text: string;
  colorClass: string;
}

interface Spark {
  line: string;
  area: string;
}

const GOOD = 'text-[#3fae8f]';
const BAD = 'text-[#d47a86]';

// Relative % change; goodUp = whether an increase should read as positive.
function relDelta(curr: number, prev: number, goodUp: boolean): Delta | null {
  if (!prev) return null;
  const pct = ((curr - prev) / prev) * 100;
  const up = pct >= 0;
  return { text: (up ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%', colorClass: (goodUp ? up : !up) ? GOOD : BAD };
}

// Absolute percentage-point change (for rates like cache-hit %, not raw counts).
function pointDelta(curr: number, prev: number, goodUp: boolean): Delta | null {
  const diff = curr - prev;
  const up = diff >= 0;
  return { text: (up ? '▲ ' : '▼ ') + Math.abs(diff).toFixed(1) + 'pp', colorClass: (goodUp ? up : !up) ? GOOD : BAD };
}

@Component({
  selector: 'app-stat-tiles',
  imports: [CardModule],
  templateUrl: './stat-tiles.component.html',
})
export class StatTilesComponent {
  data = input.required<Usage>();

  readonly fmtTokens = fmtTokens;
  readonly fmtExact = fmtExact;
  readonly fmtCost = fmtCost;

  private last14 = computed(() => this.data().daily.slice(-14));

  tokenDelta = computed<Delta | null>(() => {
    const prev = this.data().previous;
    return prev ? relDelta(this.data().totals.tokens, prev.totals.tokens, true) : null;
  });
  costDelta = computed<Delta | null>(() => {
    const prev = this.data().previous;
    return prev ? relDelta(this.data().totals.cost, prev.totals.cost, false) : null;
  });
  cacheDelta = computed<Delta | null>(() => {
    const prev = this.data().previous;
    return prev ? pointDelta(this.data().cacheEfficiency.cacheReadPct, prev.cacheEfficiency.cacheReadPct, true) : null;
  });
  subagentDelta = computed<Delta | null>(() => {
    const prev = this.data().previous;
    return prev ? relDelta(this.data().subagents.tokens, prev.subagents.tokens, false) : null;
  });

  tokenSpark = computed<Spark | null>(() => this.spark(this.last14().map((d) => d.tokens)));
  costSpark = computed<Spark | null>(() => this.spark(this.last14().map((d) => d.cost)));
  cacheSpark = computed<Spark | null>(() => this.spark(this.last14().map((d) => (d.tokens ? (d.cacheReadTokens / d.tokens) * 100 : 0))));
  subagentSpark = computed<Spark | null>(() => this.spark(this.last14().map((d) => d.subagentTokens)));

  private spark(series: number[]): Spark | null {
    if (series.length < 2) return null;
    const W = 110,
      H = 30,
      PAD = 2;
    const max = Math.max(...series, 1);
    const min = Math.min(...series, 0);
    const range = max - min || 1;
    const pts = series.map((v, i) => {
      const x = PAD + (i / (series.length - 1)) * (W - 2 * PAD);
      const y = H - PAD - ((v - min) / range) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: pts.join(' '), area: `${PAD},${H - PAD} ${pts.join(' ')} ${W - PAD},${H - PAD}` };
  }
}
