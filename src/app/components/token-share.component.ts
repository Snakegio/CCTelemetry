import { Component, computed, input } from '@angular/core';
import { type ColorMap, topSharesWithOther } from '../core/colors';
import type { ToolRow } from '../core/core';
import { fmtTokens } from '../core/format';

const RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

@Component({
  selector: 'app-token-share',
  templateUrl: './token-share.component.html',
})
export class TokenShareComponent {
  byTool = input<ToolRow[]>([]);
  colors = input.required<ColorMap>();

  shares = computed(() => topSharesWithOther(this.byTool(), this.colors()));

  totalShort = computed(() => fmtTokens(this.byTool().reduce((s, t) => s + t.tokens, 0)).replace(' ', ''));

  // stroke-dasharray/offset per slice, chained around the circle
  donut = computed(() => {
    let offset = 0;
    return this.shares().map((s) => {
      const frac = s.pct / 100;
      const dash = `${(frac * CIRCUMFERENCE).toFixed(1)} ${(CIRCUMFERENCE - frac * CIRCUMFERENCE).toFixed(1)}`;
      const seg = { color: s.color, dash, offset: (-offset).toFixed(1) };
      offset += frac * CIRCUMFERENCE;
      return seg;
    });
  });
}
