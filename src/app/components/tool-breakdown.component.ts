import { Component, computed, input } from '@angular/core';
import { TableModule } from 'primeng/table';
import type { ColorMap } from '../core/colors';
import type { ToolRow } from '../core/core';
import { basename, fmtCost, fmtExact, fmtTokens } from '../core/format';

@Component({
  selector: 'app-tool-breakdown',
  imports: [TableModule],
  templateUrl: './tool-breakdown.component.html',
})
export class ToolBreakdownComponent {
  byTool = input<ToolRow[]>([]);
  colors = input.required<ColorMap>();

  readonly fmtTokens = fmtTokens;
  readonly fmtExact = fmtExact;
  readonly fmtCost = fmtCost;
  readonly basename = basename;

  shareSegments = computed(() => {
    const items = this.byTool();
    const total = items.reduce((s, t) => s + t.tokens, 0);
    if (!total) return [];
    return items
      .map((t) => ({ pct: (t.tokens / total) * 100, color: this.colorOf(t.name), title: `${t.name}: ${fmtTokens(t.tokens)} (${((t.tokens / total) * 100).toFixed(1)}%)` }))
      .filter((s) => s.pct >= 0.4);
  });

  colorOf(name: string): string {
    return this.colors().colorOf(name);
  }

  hasDrill(row: ToolRow): boolean {
    return !!((row.children && row.children.length) || (row.drilldown && row.drilldown.length));
  }

  label(row: ToolRow): string {
    return row.isMcpGroup ? row.name.replace(/^MCP: /, '') : row.name;
  }

  badge(row: ToolRow): string {
    return row.isMcpGroup ? 'MCP' : row.isSkillGroup ? 'SKILL' : '';
  }

  avgTok(row: ToolRow): string {
    return row.calls ? fmtTokens(row.tokens / row.calls) : '—';
  }

  avgCostStr(row: ToolRow): string {
    return row.calls && row.cost > 0 ? '$' + row.avgCost.toFixed(4) : '—';
  }
}
