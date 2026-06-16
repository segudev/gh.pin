import { deletePin, listPins } from './db';
import { setState, subscribe, getState } from './state';
import { render } from './render';
import { initAddPin, initGlobalPaste, openSettingsDialog } from './ui/addPin';
import { initFilter } from './ui/filter';
import { initDrawer, selectPin, collapseSidebar } from './ui/drawer';
import { initDrag } from './ui/drag';
import { onRateChange } from './github';
import { refreshPin, loadOrFetchReadme } from './snapshots';

async function boot(): Promise<void> {
  initPwa();
  initAddPin();
  initGlobalPaste();
  initFilter();
  initDrawer();
  initDrag();

  // the footer is re-rendered on every state change, so delegate
  document.getElementById('footer')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-settings]')) openSettingsDialog();
  });
  initKeyboard();

  onRateChange((r) => {
    setState({ rateRemaining: r.remaining, rateLimit: r.limit });
  });

  let scheduled = false;
  subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      render(getState()).catch((err) => console.error('render failed', err));
    });
  });

  setState({ pins: await listPins() });

  refreshStale();
  preloadReadmes();
}

function initPwa(): void {
  // persistent storage keeps IndexedDB (pins + snapshot history) safe from
  // eviction on origins the browser considers low-engagement
  navigator.storage?.persist?.().catch(() => {});
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('sw registration failed', err);
    });
  }
}

function initKeyboard(): void {
  document.addEventListener('keydown', async (e) => {
    const target = e.target as HTMLElement | null;
    const editing =
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT');
    if (editing || document.querySelector('.dialog-bg')) return;

    if (e.key === 'Escape') {
      collapseSidebar();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('addInput')?.focus();
      return;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      moveSelection(e.key);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const id = getState().selectedId;
      if (!id) return;
      const pin = getState().pins.find((p) => p.id === id);
      if (!pin) return;
      e.preventDefault();
      if (!confirm(`unpin ${pin.owner}/${pin.repo}?`)) return;
      // pick the neighbour to keep selection flowing after the delete
      const cards = gridCards();
      const idx = cards.findIndex((c) => c.dataset.id === id);
      const next = cards[idx + 1] ?? cards[idx - 1];
      await deletePin(id);
      setState({
        pins: await listPins(),
        selectedId: next?.dataset.id ?? null,
        tick: getState().tick + 1,
      });
    }
  });
}

function gridCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.grid .card[data-id]')];
}

// geometric navigation: nearest card in the pressed direction, so it
// follows the visual masonry layout rather than DOM order
function moveSelection(key: string): void {
  const cards = gridCards();
  if (cards.length === 0) return;
  const current = cards.find((c) => c.dataset.id === getState().selectedId);
  if (!current) {
    focusCard(cards[0]);
    return;
  }
  const cr = current.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of cards) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    let primary: number;
    let cross: number;
    if (key === 'ArrowLeft') {
      if (dx >= -1) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (key === 'ArrowRight') {
      if (dx <= 1) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (key === 'ArrowUp') {
      if (dy >= -1) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else {
      if (dy <= 1) continue;
      primary = dy;
      cross = Math.abs(dx);
    }
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusCard(best);
}

function focusCard(card: HTMLElement): void {
  selectPin(card.dataset.id!);
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function refreshStale(): Promise<void> {
  const pins = getState().pins;
  for (const pin of pins) {
    try {
      await refreshPin(pin);
    } catch (err) {
      console.error(`refresh ${pin.id}`, err);
    }
  }
  setState({ pins: await listPins(), tick: getState().tick + 1 });
}

async function preloadReadmes(): Promise<void> {
  const pins = getState().pins;
  await Promise.allSettled(pins.map((p) => loadOrFetchReadme(p)));
  setState({ tick: getState().tick + 1 });
}

boot().catch((err) => console.error('boot failed', err));
