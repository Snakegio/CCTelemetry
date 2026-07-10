import {Component, computed, inject, OnDestroy, OnInit, signal} from '@angular/core';
import {buildColorMap} from './core/colors';
import {type Filters, suggestions} from './core/core';
import {basename, fmtCost, fmtExact, fmtTokens} from './core/format';
import {type Usage, UsageService} from './services/usage.service';
import type {Cell, Column} from './components/data-table.component';
import {DataTableComponent} from './components/data-table.component';
import {FiltersComponent} from './components/filters.component';
import {LiveStripComponent} from './components/live-strip.component';
import {StatTilesComponent} from './components/stat-tiles.component';
import {SuggestionsComponent} from './components/suggestions.component';
import {ToolBreakdownComponent} from './components/tool-breakdown.component';
import {UsageChartComponent} from './components/usage-chart.component';
import {WarnBannerComponent} from './components/warn-banner.component';

@Component({
  selector: 'app-root',
  imports: [
    FiltersComponent,
    WarnBannerComponent,
    LiveStripComponent,
    StatTilesComponent,
    SuggestionsComponent,
    ToolBreakdownComponent,
    UsageChartComponent,
    DataTableComponent,

  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  private usageService = inject(UsageService);
  private timer?: ReturnType<typeof setInterval>;

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

  readonly projectColumns: Column[] = [
    { label: 'Project', sortable: true },
    { label: 'Tokens', align: 'right', sortable: true },
    { label: 'Cost', align: 'right', sortable: true },
  ];
  readonly modelColumns: Column[] = [
    { label: 'Model', sortable: true },
    { label: 'Tokens', align: 'right', sortable: true },
    { label: 'Cost', align: 'right', sortable: true },
  ];
  readonly sessionColumns: Column[] = [
    { label: 'Project', sortable: true },
    { label: 'Session', sortable: true },
    { label: 'Tokens', align: 'right', sortable: true },
    { label: 'Cost', align: 'right', sortable: true },
  ];

  projectRows = computed<Cell[][]>(() =>
    (this.usage()?.byProject ?? []).map((p) => [
      { value: basename(p.project), sub: p.project, title: p.project, strong: true },
      { value: fmtTokens(p.tokens), title: fmtExact(p.tokens), num: true, sortValue: p.tokens },
      { value: fmtCost(p.cost, p.costIncomplete), num: true, sortValue: p.cost },
    ]),
  );

  modelRows = computed<Cell[][]>(() =>
    (this.usage()?.byModel ?? []).map((m) => [
      { value: m.model },
      { value: fmtTokens(m.tokens), title: fmtExact(m.tokens), num: true, sortValue: m.tokens },
      { value: fmtCost(m.cost, m.costIncomplete), num: true, sortValue: m.cost },
    ]),
  );

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
