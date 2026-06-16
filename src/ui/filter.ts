import { setState } from '../state';

export function initFilter(): void {
  const filter = document.getElementById('filter')!;
  filter.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.item') as HTMLElement | null;
    if (!target) return;
    const tag = target.dataset.tag ?? null;
    setState({ filterTag: tag });
  });
}
