import { Injectable, signal } from '@angular/core';
import type { Filters } from '../core/core';

const DEFAULT_FILTERS: Filters = { range: 'today', projects: [], from: '', to: '' };

// Shared across Dashboard and Analysis so switching views keeps the same
// period/project selection instead of each page resetting its own filters.
@Injectable({ providedIn: 'root' })
export class FiltersStore {
  filters = signal<Filters>(DEFAULT_FILTERS);
}
