import { db, listPins } from '../db';
import { setState, getState } from '../state';
import { withFlip } from '../lib/flip';

let draggingId: string | null = null;
let lastTarget: HTMLElement | null = null;
let lastAfter = false;
let lastX = -1;
let lastY = -1;
// edge auto-scroll: native DnD does not scroll the window, so we run our own
// rAF loop that nudges the page when the cursor nears the top/bottom edge
let pointerY = 0;
let scrollRAF = 0;

const EDGE = 96; // distance from a viewport edge where scrolling kicks in (px)
const MAX_SPEED = 22; // peak scroll step at the very edge (px per frame)

function autoScroll(): void {
  if (!draggingId) {
    scrollRAF = 0;
    return;
  }
  const vh = window.innerHeight;
  let dy = 0;
  if (pointerY < EDGE) {
    const t = Math.min(1, (EDGE - pointerY) / EDGE);
    dy = -MAX_SPEED * t * t; // squared so it accelerates toward the edge
  } else if (pointerY > vh - EDGE) {
    const t = Math.min(1, (pointerY - (vh - EDGE)) / EDGE);
    dy = MAX_SPEED * t * t;
  }
  if (dy) window.scrollBy(0, dy);
  scrollRAF = requestAnimationFrame(autoScroll);
}

export function initDrag(): void {
  const grid = document.getElementById('grid')!;

  grid.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!card?.dataset.id) return;
    draggingId = card.dataset.id;
    e.dataTransfer?.setData('text/plain', draggingId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    pointerY = e.clientY;
    if (!scrollRAF) scrollRAF = requestAnimationFrame(autoScroll);
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
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = 0;
  });

  // make room as you hover: the ghost slides into the hovered slot and
  // the other cards glide aside (FLIP), like rearranging iphone icons
  grid.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    pointerY = e.clientY; // feed the edge auto-scroll loop
    // dragover keeps firing while the cursor sits still; reacting to our own
    // reflow under a stationary cursor swaps the same cards back and forth
    if (e.clientX === lastX && e.clientY === lastY) return;
    // vertical pointer direction, captured before we overwrite lastY
    const movingUp = lastY !== -1 && e.clientY < lastY;
    const movingDown = lastY !== -1 && e.clientY > lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const dragEl = grid.querySelector<HTMLElement>('.dragging');
    const target = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!dragEl || !target || !target.dataset.id || target === dragEl) return;

    // place by cursor position, not DOM order: DOM order inverts after each
    // move, so the same hover point would keep swapping the pair.
    // use a shallow activation zone in the direction of travel instead of the
    // full midpoint: the swap fires shortly after the cursor crosses into the
    // neighbour, so you no longer have to drag ~half a card before it reacts.
    // gate each swap on pointer direction: only place-after while moving down,
    // place-before while moving up. when the neighbour is taller than the
    // dragged card the cursor stays over it after the reflow and the direction
    // flips, which would swap straight back. a reflow can't fake pointer
    // direction, so requiring it kills that flicker.
    const rect = target.getBoundingClientRect();
    const zone = rect.height * 0.25;
    const targetIsAfter = !!(
      dragEl.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    let after: boolean;
    if (targetIsAfter) {
      if (movingUp) return;
      if (e.clientY <= rect.top + zone) return; // not far enough in yet
      after = true;
    } else {
      if (movingDown) return;
      if (e.clientY >= rect.bottom - zone) return;
      after = false;
    }
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
