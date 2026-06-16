// FLIP helper: measure card positions, mutate the DOM, then animate each
// card from its old position to its new one so reorders glide instead of jump.

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function withFlip(
  container: HTMLElement,
  mutate: () => void,
  opts: { animateNew?: boolean } = {},
): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    mutate();
    return;
  }
  const before = new Map<string, DOMRect>();
  for (const el of container.querySelectorAll<HTMLElement>('[data-id]')) {
    before.set(el.dataset.id!, el.getBoundingClientRect());
  }
  mutate();
  for (const el of container.querySelectorAll<HTMLElement>('[data-id]')) {
    if (el.classList.contains('dragging')) continue;
    const prev = before.get(el.dataset.id!);
    if (!prev) {
      if (opts.animateNew) {
        el.animate(
          [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }],
          { duration: 300, easing: EASE },
        );
      }
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 420, easing: EASE },
      );
    }
  }
}
