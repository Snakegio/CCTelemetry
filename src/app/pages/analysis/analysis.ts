import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AnalysisFindings } from '../../components/analysis-findings';
import { FiltersComponent } from '../../components/filters.component';
import { Header } from '../../components/header';
import { analyzeUsage } from '../../core/analysis';
import type { Filters } from '../../core/core';
import { FiltersStore } from '../../services/filters-store';
import { type Usage, UsageService } from '../../services/usage.service';

@Component({
  selector: 'app-analysis',
  imports: [Header, FiltersComponent, AnalysisFindings],
  templateUrl: './analysis.html',
})
export class Analysis implements OnInit, OnDestroy {
  private usageService = inject(UsageService);
  private filtersStore = inject(FiltersStore);
  private timer?: ReturnType<typeof setInterval>;

  usage = signal<Usage | null>(null);
  filters = this.filtersStore.filters;

  findings = computed(() => {
    const u = this.usage();
    return u ? analyzeUsage(u) : [];
  });

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
    const cur = this.filters();
    const pruned = (cur.projects || []).filter((p) => data.projects.includes(p));
    if (pruned.length !== (cur.projects || []).length) this.filters.set({ ...cur, projects: pruned });
    this.usage.set(data);
  }
}
