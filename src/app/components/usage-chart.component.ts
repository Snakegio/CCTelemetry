import { Component, computed, input, signal } from '@angular/core';
import type { ColorMap } from '../core/colors';
import type { DailyEntry } from '../core/core';
import { fmtCost, fmtDay, fmtTokens } from '../core/format';

const W = 1000;
const H = 210;
const PAD_L = 8;
const PAD_R = 8;
const PAD_B = 22;
const PAD_T = 20;
const PLOT_H = H - PAD_T - PAD_B;

interface TipRow {
  name: string;
  v: number;
  color: string;
}

@Component({
  selector: 'app-usage-chart',
  templateUrl: './usage-chart.component.html',
})
export class UsageChartComponent {
  daily = input<DailyEntry[]>([]);
  colors = input.required<ColorMap>();

  readonly W = W;
  readonly H = H;
  readonly fmtTokens = fmtTokens;

  tip = signal<{ show: boolean; left: number; top: number; title: string; rows: TipRow[] }>({
    show: false,
    left: 0,
    top: 0,
    title: '',
    rows: [],
  });

  chart = computed(() => {
    const daily = this.daily();
    const colors = this.colors();
    if (!daily.length) {
      return { empty: true, legend: [], gridlines: [], bars: [], hits: [], xlabels: [] };
    }

    const hasOther = daily.some((d) => Object.keys(d.byTool || {}).some((k) => !colors.top.includes(k)));
    const seriesNames = hasOther ? [...colors.top, 'Other'] : colors.top;
    const colorForSeries = (name: string) => (name === 'Other' ? colors.other : colors.colorOf(name));
    const legend = seriesNames.map((name) => ({ name, color: colorForSeries(name) }));

    const max = Math.max(...daily.map((d) => d.tokens), 1);
    const gridlines = [0, 0.5, 1].map((frac) => {
      const y = PAD_T + PLOT_H - frac * PLOT_H;
      return { y, label: frac > 0 ? fmtTokens(max * frac) : null, labelY: y - 4 };
    });

    const n = daily.length;
    const slot = (W - PAD_L - PAD_R) / n;
    const barW = Math.max(4, Math.min(46, slot - 2));
    const GAP = 2;

    const bars: { rects: { x: number; y: number; w: number; h: number; fill: string }[] }[] = [];
    const hits: { x: number; y: number; w: number; h: number; title: string; rows: TipRow[]; dayIndex: number }[] = [];
    const xlabels: { x: number; y: number; text: string }[] = [];

    daily.forEach((d, i) => {
      const x = PAD_L + i * slot + (slot - barW) / 2;
      const values = seriesNames.map((name) => {
        if (name === 'Other') {
          let sum = 0;
          for (const [k, v] of Object.entries(d.byTool || {})) if (!colors.top.includes(k)) sum += v;
          return sum;
        }
        return (d.byTool || {})[name] || 0;
      });

      let yCursor = PAD_T + PLOT_H;
      const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
      values.forEach((v, si) => {
        if (v <= 0) return;
        const h = (v / max) * PLOT_H;
        const drawH = Math.max(0, h - GAP);
        if (drawH <= 0) {
          yCursor -= h;
          return;
        }
        rects.push({ x, y: yCursor - h, w: barW, h: drawH, fill: colorForSeries(seriesNames[si]) });
        yCursor -= h;
      });
      bars.push({ rects });

      const rows = seriesNames
        .map((name, si) => ({ name, v: values[si], color: colorForSeries(name) }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v);
      const title = `${fmtDay(d.date)} — ${fmtTokens(d.tokens)} tokens · ${fmtCost(d.cost, d.costIncomplete)}`;
      hits.push({ x: PAD_L + i * slot, y: PAD_T, w: slot, h: PLOT_H, title, rows, dayIndex: i });

      if (i === 0 || i === n - 1 || (n > 8 && i % 5 === 0 && i < n - 2)) {
        xlabels.push({ x: PAD_L + i * slot + slot / 2, y: H - 6, text: fmtDay(d.date) });
      }
    });

    return { empty: false, legend, gridlines, bars, hits, xlabels };
  });

  hoverIndex = signal<number | null>(null);

  enterTip(hit: { title: string; rows: TipRow[]; dayIndex: number }): void {
    this.tip.update((t) => ({ ...t, show: true, title: hit.title, rows: hit.rows }));
    this.hoverIndex.set(hit.dayIndex);
  }

  moveTip(ev: MouseEvent, wrap: HTMLElement): void {
    const rect = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(ev.clientX - rect.left, 110), rect.width - 110);
    const top = ev.clientY - rect.top - 12;
    this.tip.update((t) => ({ ...t, left, top }));
  }

  hideTip(): void {
    this.tip.update((t) => ({ ...t, show: false }));
    this.hoverIndex.set(null);
  }
}
