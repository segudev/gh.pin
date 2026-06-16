import { db, listPins } from '../db';
import { setState, getState } from '../state';
import { withFlip } from '../lib/flip';

let draggingId: string | null = null;
let lastTarget: HTMLElement | null = null;
let lastAfter = false;
let lastX = -1;
let lastY = -1;

export function initDrag(): void {
  const grid = document.getElementById('grid')!;

  grid.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!card?.dataset.id) return;
    draggingId = card.dataset.id;
    e.dataTransfer?.setData('text/plain', draggingId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // dim after the browser captures the drag image, so the floating
    // copy stays crisp while the in-grid original becomes the ghost
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  grid.addEventListener('dragend', () => {
    grid.querySelector('.dragging')?.classList.remove('dragging');
    draggingId = null;
    lastTarget = null;
    lastX = -1;
    lastY = -1;
  });

  // make room as you hover: the ghost slides into the hovered slot and
  // the other cards glide aside (FLIP), like rearranging iphone icons
  grid.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    // dragover keeps firing while the cursor sits still; reacting to our own
    // reflow under a stationary cursor swaps the same cards back and forth
    if (e.clientX === lastX && e.clientY === lastY) return;
    lastX = e.clientX;
    lastY = e.clientY;
    const dragEl = grid.querySelector<HTMLElement>('.dragging');
    const target = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!dragEl || !target || !target.dataset.id || target === dragEl) return;

    // place by cursor position, not DOM order: DOM order inverts after each
    // move, so the same hover point would keep swapping the pair
    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (target === lastTarget && after === lastAfter) return;
    lastTarget = target;
    lastAfter = after;
    if ((after ? target.nextElementSibling : target.previousElementSibling) === dragEl) return;

    withFlip(grid, () => {
      if (after) target.after(dragEl);
      else target.before(dragEl);
    });
  });

  grid.addEventListener('drop', async (e) => {
    if (!draggingId) return;
    e.preventDefault();
    const order = [...grid.querySelectorAll<HTMLElement>('.card[data-id]')].map(
      (el) => el.dataset.id!,
    );
    await db.transaction('rw', db.pins, async () => {
      for (let i = 0; i < order.length; i++) {
        await db.pins.update(order[i], { order: i + 1 });
      }
    });
    setState({ pins: await listPins(), tick: getState().tick + 1 });
  });
}
