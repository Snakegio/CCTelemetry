import {Component, computed, inject, OnDestroy, OnInit, signal} from '@angular/core';
import {buildColorMap, categoricalPalette} from './core/colors';
import {type Filters, suggestions} from './core/core';
import {basename, fmtCost, fmtExact, fmtTokens} from './core/format';
import {type Usage, UsageService} from './services/usage.service';
import type {Cell, Column} from './components/data-table.component';
import {DataTableComponent} from './components/data-table.component';
import type {BarRow} from './components/bar-list.component';
import {BarListComponent} from './components/bar-list.component';
import {FiltersComponent} from './components/filters.component';
import {LiveStripComponent} from './components/live-strip.component';
import {StatTilesComponent} from './components/stat-tiles.component';
import {SuggestionsComponent} from './components/suggestions.component';
import {TokenShareComponent} from './components/token-share.component';
import {ToolBreakdownComponent} from './components/tool-breakdown.component';
import {UsageChartComponent} from './components/usage-chart.component';
import {WarnBannerComponent} from './components/warn-banner.component';
import {Theme} from './services/theme';

const PREV_LABEL: Record<string, string> = { today: 'day', '7d': '7 days', '30d': '30 days' };

@Component({
  selector: 'app-root',
  imports: [
    FiltersComponent,
    WarnBannerComponent,
    LiveStripComponent,
    StatTilesComponent,
    SuggestionsComponent,
    ToolBreakdownComponent,
    TokenShareComponent,
    UsageChartComponent,
    DataTableComponent,
    BarListComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  private usageService = inject(UsageService);
  private timer?: ReturnType<typeof setInterval>;
  readonly theme = inject(Theme);

  usage = signal<Usage | null>(null);
  filters = signal<Filters>({ range: 'today', projects: [], from: '', to: '' });

  colorMap = computed(() => {
    const u = this.usage();
    return u ? buildColorMap(u.daily) : null;
  });
  suggestionsList = computed(() => {
    const u = this.usage();
    return u ? suggestions(u) : [];
  });
  liveVisible = computed(() => !!this.usage()?.liveSession && this.filters().range === 'today');

  themeIcon = computed(() => (this.theme.current() === 'dark' ? '☀' : '☾'));
  prevLabel = computed(() => (this.usage()?.previous ? (PREV_LABEL[this.filters().range ?? ''] ?? null) : null));

  readonly sessionColumns: Column[] = [
    { label: 'Project', sortable: true },
    { label: 'Session', sortable: true },
    { label: 'Tokens', align: 'right', sortable: true },
    { label: 'Cost', align: 'right', sortable: true },
  ];

  projectBars = computed<BarRow[]>(() => {
    const rows = this.usage()?.byProject ?? [];
    const max = Math.max(...rows.map((p) => p.tokens), 1);
    return rows.map((p) => ({ name: basename(p.project), tokens: fmtTokens(p.tokens), cost: fmtCost(p.cost, p.costIncomplete), barPct: (p.tokens / max) * 100 }));
  });

  modelBars = computed<BarRow[]>(() => {
    const rows = this.usage()?.byModel ?? [];
    const palette = categoricalPalette();
    const max = Math.max(...rows.map((m) => m.tokens), 1);
    return rows.map((m, i) => ({
      name: m.model,
      tokens: fmtTokens(m.tokens),
      cost: fmtCost(m.cost, m.costIncomplete),
      barPct: (m.tokens / max) * 100,
      color: palette[i % palette.length],
    }));
  });

  sessionRows = computed<Cell[][]>(() =>
    (this.usage()?.topSessions ?? []).map((s) => [
      { value: basename(s.project), title: s.project, strong: true },
      { value: s.label, title: s.sessionId, muted: true },
      { value: fmtTokens(s.tokens), title: fmtExact(s.tokens), num: true, sortValue: s.tokens },
      { value: fmtCost(s.cost, s.costIncomplete), num: true, sortValue: s.cost },
    ]),
  );

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onFilters(f: Filters): void {
    this.filters.set(f);
    this.refresh();
  }

  private async refresh(): Promise<void> {
    let data: Usage;
    try {
      data = await this.usageService.getUsage(this.filters());
    } catch {
      return; // data source briefly unavailable; retry on next tick
    }
    // drop selected projects that no longer exist so an old filter can't linger
    const cur = this.filters();
    const pruned = (cur.projects || []).filter((p) => data.projects.includes(p));
    if (pruned.length !== (cur.projects || []).length) this.filters.set({ ...cur, projects: pruned });
    this.usage.set(data);
  }
}
