import type { ReportPeriod } from '../types';

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Monday on or before d. */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** Inclusive day range (YYYY-MM-DD) that a period covers — used to bound the
 *  Reporting and Archive time slices. */
export function periodRange(
  period: ReportPeriod,
  custFrom: string,
  custTo: string,
  today: Date,
): { from: string; to: string } {
  if (period === 'woche') {
    const mon = mondayOf(today);
    return { from: dayKey(mon), to: dayKey(addDays(mon, 6)) };
  }
  if (period === 'monat') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: dayKey(first), to: dayKey(last) };
  }
  if (period === 'jahr') {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }
  // zeitraum (and any fallback): normalise order
  const from = custFrom <= custTo ? custFrom : custTo;
  const to = custFrom <= custTo ? custTo : custFrom;
  return { from, to };
}
