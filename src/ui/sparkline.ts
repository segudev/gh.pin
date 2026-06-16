import type { Snapshot } from '../db';

export interface SparkResult {
  points: string;
  growthPct: number | null;
  flat: boolean;
}

export function buildSparkline(snapshots: Snapshot[], width = 200, height = 22): SparkResult {
  if (snapshots.length < 2) {
    return { points: flatLine(width, height), growthPct: null, flat: true };
  }
  const sorted = [...snapshots].sort((a, b) => a.takenAt - b.takenAt);
  const values = sorted.map((s) => s.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);

  const xStep = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 2;
  const usable = height - pad * 2;
  const pts = values
    .map((v, i) => {
      const x = i * xStep;
      const y = pad + (1 - (v - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const first = values[0];
  const last = values[values.length - 1];
  const growthPct = first === 0 ? null : ((last - first) / first) * 100;
  const flat = max - min === 0;

  return { points: pts, growthPct, flat };
}

function flatLine(width: number, height: number): string {
  const y = (height / 2).toFixed(1);
  return `0,${y} ${width},${y}`;
}

export function sparkSvg(width = 200, height = 22, points = '', stroke = '#15171c'): string {
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}" stroke="${stroke}" stroke-width="1" fill="none"/></svg>`;
}
