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
