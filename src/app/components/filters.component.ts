import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import type { Filters } from '../core/core';
import { basename } from '../core/format';

@Component({
  selector: 'app-filters',
  imports: [FormsModule, SelectButtonModule, MultiSelectModule, DatePickerModule],
  templateUrl: './filters.component.html',
})
export class FiltersComponent {
  projects = input<string[]>([]);
  filters = input.required<Filters>();
  filtersChange = output<Filters>();

  readonly ranges: { key: string; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: 'all', label: 'All time' },
    { key: 'custom', label: 'Custom' },
  ];

  // { label: basename, value: path } options for the MultiSelect
  projectOptions = computed(() => this.projects().map((p) => ({ label: basename(p), value: p })));

  showDates = computed(() => this.filters().range === 'custom');

  readonly today = new Date();

  // p-datepicker in selectionMode="range" works with a [from, to] array of Date
  rangeDates = computed<Date[]>(() =>
    [this.parseDate(this.filters().from), this.parseDate(this.filters().to)].filter((d): d is Date => d !== null),
  );

  private parseDate(s: string | undefined): Date | null {
    return s ? new Date(s + 'T00:00:00') : null;
  }
  private toIso(d: Date | null): string {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  setRange(key: string): void {
    if (!key) return; // SelectButton can emit null on deselect; ignore it
    this.filtersChange.emit({ ...this.filters(), range: key, from: '', to: '' });
  }

  setProjects(selected: string[]): void {
    this.filtersChange.emit({ ...this.filters(), projects: selected ?? [] });
  }

  setRangeDates(dates: (Date | null)[] | null): void {
    const [from, to] = dates ?? [];
    this.filtersChange.emit({ ...this.filters(), range: 'custom', from: this.toIso(from ?? null), to: this.toIso(to ?? null) });
  }
}
