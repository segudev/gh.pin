import { setState } from '../state';

const layout = () => document.getElementById('layout')!;

export function initDrawer(): void {
  document.getElementById('sbClose')?.addEventListener('click', () => {
    setState({ selectedId: null });
  });
}

export function collapseSidebar(): void {
  setState({ selectedId: null });
  layout().classList.add('collapsed');
}

export function selectPin(id: string | null, view: 'readme' | 'detail' = 'readme'): void {
  setState({ selectedId: id, sbView: view });
  if (id) layout().classList.remove('collapsed');
}
