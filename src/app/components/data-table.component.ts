import { Component, computed, input } from '@angular/core';
import { TableModule } from 'primeng/table';

export interface Column {
  label: string;
  align?: 'right';
  sortable?: boolean;
}

export interface Cell {
  value: string;
  sub?: string; // optional muted second line (e.g. project path)
  title?: string; // tooltip on the cell
  align?: 'right';
  num?: boolean; // monospace tabular
  strong?: boolean; // emphasized, truncated main text
  muted?: boolean; // muted, truncated main text (e.g. session label)
  sortValue?: number; // valore grezzo per l'ordinamento numerico (colonne num)
}

// One dumb table for the plain breakdowns (project / model / sessions), ora su
// p-table. Il parent mappa le righe di dominio in Cell[][]; il tool table con
// drill-down vive nel suo ToolBreakdownComponent.
@Component({
  selector: 'app-data-table',
  imports: [TableModule],
  templateUrl: './data-table.component.html',
})
export class DataTableComponent {
  columns = input.required<Column[]>();
  rows = input.required<Cell[][]>();

  // p-table ordina per field su oggetti: mappiamo ogni riga in { c0, c1, … }.
  rowObjects = computed(() =>
    this.rows().map((row) => {
      const o: Record<string, Cell> = {};
      row.forEach((cell, i) => (o['c' + i] = cell));
      return o;
    }),
  );

  cellClass(cell: Cell): string {
    return cell.num ? 'num text-right text-[.82rem]' : '';
  }
}
