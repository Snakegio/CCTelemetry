import { Component, computed, input, signal } from '@angular/core';
import { CardModule } from 'primeng/card';
import type { Finding, FindingCategory } from '../core/analysis';
import { fmtTokens } from '../core/format';

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  model: 'Model',
  cache: 'Cache',
  'tool-pattern': 'Tool pattern',
  anomaly: 'Anomaly',
};

const DISMISSED_KEY = 'dismissedFindings';

@Component({
  selector: 'app-analysis-findings',
  imports: [CardModule],
  templateUrl: './analysis-findings.html',
})
export class AnalysisFindings {
  // Already ranked by impact in analyzeUsage(); rendered top-down as received.
  findings = input<Finding[]>([]);
  private dismissed = signal<Set<string>>(this.load());

  visible = computed(() => {
    const d = this.dismissed();
    return this.findings().filter((f) => !d.has(f.id));
  });

  categoryLabel(c: FindingCategory): string {
    return CATEGORY_LABELS[c];
  }

  dismiss(id: string): void {
    const next = new Set(this.dismissed());
    next.add(id);
    this.dismissed.set(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // storage unavailable — keep the in-memory dismissal only
    }
  }

  private load(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  protected readonly fmtTokens = fmtTokens;
}
