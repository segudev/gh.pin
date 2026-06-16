import type { Pin } from './db';

export interface AppState {
  pins: Pin[];
  filterTag: string | null;
  selectedId: string | null;
  sbView: 'readme' | 'detail';
  rateRemaining: number | null;
  rateLimit: number | null;
  tick: number;
}

let state: AppState = {
  pins: [],
  filterTag: null,
  selectedId: null,
  sbView: 'readme',
  rateRemaining: null,
  rateLimit: null,
  tick: 0,
};

const listeners = new Set<(s: AppState) => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn: (s: AppState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
