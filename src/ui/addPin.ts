import { db, listPins, getSetting, setSetting } from '../db';
import { parseRepoUrl, repoId } from '../lib/parseRepoUrl';
import { refreshPin, loadOrFetchReadme } from '../snapshots';
import { RateLimitError } from '../github';
import { setState, getState } from '../state';

const TOKEN_THRESHOLD = 10;

const PROMPT_PINS =
  'You have 11 or more pinned repos. The unauthenticated GitHub API limit (60/hr) will not be enough. Paste a personal access token (no scopes required for public repos). The token stays in your browser.';
const PROMPT_RATELIMIT =
  'GitHub rate limit hit (60/hr unauthenticated). Paste a personal access token to raise it to 5,000/hr (no scopes required for public repos). The token stays in your browser.';

export type AddResult = 'added' | 'duplicate' | 'invalid';

export async function addFromText(value: string): Promise<{ result: AddResult; id?: string }> {
  const ref = parseRepoUrl(value);
  if (!ref) return { result: 'invalid' };
  const id = repoId(ref);

  const existing = await db.pins.get(id);
  if (existing) {
    setState({ selectedId: id });
    return { result: 'duplicate', id };
  }

  const pinCount = await db.pins.count();
  if (pinCount >= TOKEN_THRESHOLD) {
    const token = await getSetting<string>('githubToken');
    if (!token) {
      const entered = await promptForToken(PROMPT_PINS);
      if (entered) await setSetting('githubToken', entered);
    }
  }

  const minOrder = (await listPins()).reduce((m, p) => Math.min(m, p.order ?? 0), 0);
  await db.pins.put({
    id,
    owner: ref.owner,
    repo: ref.repo,
    addedAt: Date.now(),
    order: minOrder - 1,
    tags: [],
  });

  setState({ pins: await listPins(), selectedId: id });

  refreshPin((await db.pins.get(id))!, { force: true })
    .then(async () => {
      // readme is needed anyway for reading mode; fetching now also
      // extracts the cover-image candidates for the card hero
      await loadOrFetchReadme((await db.pins.get(id))!).catch(() => null);
      setState({ pins: await listPins(), tick: getState().tick + 1 });
    })
    .catch(async (err) => {
      console.error('refresh failed', err);
      // a token added here lets the just-pinned repo refresh immediately
      if (await maybePromptForToken(err)) {
        await refreshPin((await db.pins.get(id))!, { force: true }).catch(() => {});
        await loadOrFetchReadme((await db.pins.get(id))!).catch(() => null);
        setState({ pins: await listPins(), tick: getState().tick + 1 });
      }
    });

  return { result: 'added', id };
}

export function initAddPin(): void {
  const form = document.getElementById('addForm') as HTMLFormElement | null;
  const input = document.getElementById('addInput') as HTMLInputElement | null;
  if (!form || !input) return;

  // the tile is a bare "+" until it has focus; clicking anywhere on it expands it
  document.getElementById('addTile')?.addEventListener('click', () => input.focus());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value;
    const { result } = await addFromText(value);
    if (result === 'invalid') {
      input.style.color = 'var(--bad)';
      setTimeout(() => (input.style.color = ''), 600);
      return;
    }
    input.value = '';
  });
}

export function initGlobalPaste(): void {
  document.addEventListener('paste', async (e) => {
    const target = e.target as HTMLElement | null;
    if (target && isEditable(target)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const { result } = await addFromText(text);
    if (result === 'invalid') {
      flash('not a github url', true);
      return;
    }
    if (result === 'duplicate') {
      flash('already pinned');
      return;
    }
    flash('pinned');
  });
}

function isEditable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

let flashTimer: number | undefined;
function flash(msg: string, bad = false): void {
  let el = document.querySelector<HTMLElement>('.paste-flash');
  if (!el) {
    el = document.createElement('div');
    el.className = 'paste-flash';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('on');
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el!.classList.remove('on'), 1400);
}

// Fires the token dialog in response to a rate-limit error so the user sees a
// fix instead of a stalled grid. Returns true when a new token was saved (the
// caller can then retry). Guarded so parallel failures open only one dialog.
let tokenPromptOpen = false;
export async function maybePromptForToken(err: unknown): Promise<boolean> {
  if (!(err instanceof RateLimitError)) return false;
  // already authenticated; a token cannot raise the limit further, just inform
  if (err.hasToken) {
    flash(err.message, true);
    return false;
  }
  if (tokenPromptOpen) return false;
  tokenPromptOpen = true;
  try {
    if (await getSetting<string>('githubToken')) return false;
    const entered = await promptForToken(PROMPT_RATELIMIT);
    if (!entered) {
      flash('rate limited - add a token in settings', true);
      return false;
    }
    await setSetting('githubToken', entered);
    flash('token saved');
    return true;
  } finally {
    tokenPromptOpen = false;
  }
}

function promptForToken(message: string): Promise<string | null> {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'dialog-bg on';
    bg.innerHTML = `
      <div class="dialog">
        <h2>github token</h2>
        <p>${message}</p>
        <input type="password" id="patInput" placeholder="ghp_...">
        <div class="row-actions">
          <button class="muted" data-cancel>skip</button>
          <button data-save>save</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    const inp = bg.querySelector<HTMLInputElement>('#patInput')!;
    inp.focus();
    const close = (val: string | null) => {
      bg.remove();
      resolve(val);
    };
    bg.querySelector('[data-cancel]')!.addEventListener('click', () => close(null));
    bg.querySelector('[data-save]')!.addEventListener('click', () => close(inp.value.trim() || null));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(inp.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });
  });
}

export async function openSettingsDialog(): Promise<void> {
  const current = (await getSetting<string>('githubToken')) ?? '';
  const bg = document.createElement('div');
  bg.className = 'dialog-bg on';
  bg.innerHTML = `
    <div class="dialog">
      <h2>settings</h2>
      <p>GitHub personal access token (optional below 11 pins, recommended above). Stored locally in IndexedDB.</p>
      <input type="password" id="patInput" placeholder="ghp_..." value="${escapeHtml(current)}">
      <h2>backup</h2>
      <p>Pins, tags and history live only in this browser. Export a JSON file to back up or move to another machine.</p>
      <div class="row-actions backup-row">
        <button data-export>export json</button>
        <button data-import>import json</button>
        <input type="file" accept="application/json,.json" data-import-file hidden>
      </div>
      <div class="row-actions">
        <button class="muted" data-cancel>cancel</button>
        <button data-clear>clear</button>
        <button data-save>save</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  const inp = bg.querySelector<HTMLInputElement>('#patInput')!;
  inp.focus();
  const close = () => bg.remove();

  bg.querySelector('[data-export]')!.addEventListener('click', async () => {
    const [pins, snapshots, releases] = await Promise.all([
      db.pins.toArray(),
      db.snapshots.toArray(),
      db.releases.toArray(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), pins, snapshots, releases }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ghpin-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = bg.querySelector<HTMLInputElement>('[data-import-file]')!;
  bg.querySelector('[data-import]')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.pins)) throw new Error('no pins array');
      await db.transaction('rw', db.pins, db.snapshots, db.releases, async () => {
        await db.pins.bulkPut(data.pins);
        if (Array.isArray(data.snapshots)) await db.snapshots.bulkPut(data.snapshots);
        if (Array.isArray(data.releases)) await db.releases.bulkPut(data.releases);
      });
      setState({ pins: await listPins(), tick: getState().tick + 1 });
      close();
    } catch (err) {
      alert(`import failed: ${(err as Error).message}`);
    }
  });
  bg.querySelector('[data-cancel]')!.addEventListener('click', close);
  bg.querySelector('[data-clear]')!.addEventListener('click', async () => {
    await setSetting('githubToken', '');
    close();
  });
  bg.querySelector('[data-save]')!.addEventListener('click', async () => {
    await setSetting('githubToken', inp.value.trim());
    close();
  });
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
