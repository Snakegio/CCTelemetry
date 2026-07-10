// Display formatting helpers (ported from the inline script in the old
// index.html). Escaping is handled by Angular bindings, so no esc() here.

export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + ' K';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtExact(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtCost(cost: number, incomplete = false): string {
  if (cost === 0 && incomplete) return '— *';
  const s = cost >= 100 ? '$' + cost.toFixed(0) : cost >= 0.01 ? '$' + cost.toFixed(2) : cost > 0 ? '<$0.01' : '$0';
  return s + (incomplete ? ' *' : '');
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

export function keyOf(s: string): string {
  return 'k-' + String(s).replace(/[^a-zA-Z0-9]/g, '_');
}

export function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(m, 10) - 1] + ' ' + parseInt(d, 10);
}
