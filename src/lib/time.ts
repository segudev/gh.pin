const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '--';
  const diff = Math.max(0, now - ts);
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))}m`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h`;
  if (diff < 30 * DAY) return `${Math.round(diff / DAY)}d`;
  if (diff < 365 * DAY) return `${Math.round(diff / (30 * DAY))}mo`;
  return `${Math.round(diff / (365 * DAY))}y`;
}

export function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function formatStars(n: number | undefined): string {
  if (n === undefined || n === null) return '--';
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return n.toLocaleString('en-US');
  return String(n);
}

export function formatDelta(n: number | undefined | null): string {
  if (n === undefined || n === null) return '--';
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : String(n);
}
