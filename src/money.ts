/** USD formatting; amounts are integer cents in the database. */

export function formatUsd(cents: number, mode: "rounded" | "exact"): string {
  const dollars = cents / 100;
  if (mode === "rounded") {
    const r = Math.round(dollars);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(r);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function centsToInputString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseMoneyToCents(raw: string): number | null {
  const t = raw.trim().replace(/[$,]/g, "");
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function currentYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** First and last calendar day for YYYY-MM as ISO YYYY-MM-DD */
export function fullMonthBoundsFromYearMonth(ym: string): { periodStart: string; periodEnd: string } {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const start = `${ys}-${ms}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${ys}-${ms}-${String(last).padStart(2, "0")}`;
  return { periodStart: start, periodEnd: end };
}

/** Next calendar month after `periodEndIso` (YYYY-MM-DD), as full-month bounds */
export function nextFullMonthAfterPeriodEnd(periodEndIso: string): { periodStart: string; periodEnd: string } {
  const d = new Date(periodEndIso + "T12:00:00");
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return fullMonthBoundsFromYearMonth(`${y}-${m}`);
}
