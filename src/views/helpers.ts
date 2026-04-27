export function varianceClassIncome(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

export function varianceClassExpense(varianceCents: number): string {
  if (varianceCents > 0) return "variance-good";
  if (varianceCents < 0) return "variance-bad";
  return "";
}

export function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  const last = parts[parts.length - 1] ?? path;
  return last.replace(/\.mimo$/i, "");
}

export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
