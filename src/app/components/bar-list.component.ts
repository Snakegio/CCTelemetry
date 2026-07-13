import { Component, input } from '@angular/core';

export interface BarRow {
  name: string;
  tokens: string;
  cost: string;
  barPct: number;
  color?: string; // defaults to the accent color when omitted
}

// Reusable name + tokens/cost + progress-bar row, shared by "By project" and
// "By model" (each row's width is relative to the max value in its own list).
@Component({
  selector: 'app-bar-list',
  templateUrl: './bar-list.component.html',
})
export class BarListComponent {
  rows = input.required<BarRow[]>();
}
