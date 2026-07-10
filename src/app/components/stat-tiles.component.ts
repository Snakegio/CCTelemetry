import { Component, computed, input } from '@angular/core';
import { CardModule } from 'primeng/card';
import type { Usage } from '../services/usage.service';
import { fmtCost, fmtExact, fmtTokens } from '../core/format';

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

  // Sparkline geometry for the total-tokens tile.
  spark = computed(() => {
    const daily = this.data().daily;
    if (daily.length < 2) return null;
    const W = 110,
      H = 30,
      PAD = 2;
    const max = Math.max(...daily.map((d) => d.tokens), 1);
    const pts = daily.map((d, i) => {
      const x = PAD + (i / (daily.length - 1)) * (W - 2 * PAD);
      const y = H - PAD - (d.tokens / max) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: pts.join(' '), area: `${PAD},${H - PAD} ${pts.join(' ')} ${W - PAD},${H - PAD}` };
  });
}
