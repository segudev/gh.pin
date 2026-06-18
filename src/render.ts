import type { AppState } from './state';
import { db, type Pin, type Snapshot, deletePin, latestSnapshots, listPins } from './db';
import { heroCandidates } from './lib/cover';
import { withFlip } from './lib/flip';
import { healthFromLastCommit, type Health } from './lib/health';
import { relativeTime, formatStars } from './lib/time';
import { buildSparkline } from './ui/sparkline';
import { buildSidebarContext, renderSidebar } from './ui/sidebarRender';
import { selectPin } from './ui/drawer';
import { refreshPin } from './snapshots';
import { setState, getState } from './state';

const cardSnapshots = new Map<string, Snapshot[]>();
const cardEls = new Map<string, HTMLElement>();
const pinById = new Map<string, Pin>();
let lastGridKey = '';
let lastSidebarKey = '';
let lastSelectedId: string | null = null;

const HEALTH_LABEL: Record<Health, string> = { ok: 'active', warn: 'quiet', bad: 'dormant' };

export async function render(state: AppState): Promise<void> {
  pinById.clear();
  for (const pin of state.pins) pinById.set(pin.id, pin);

  const visible = state.filterTag
    ? state.pins.filter((p) => p.tags.includes(state.filterTag!))
    : state.pins;

  const gridKey =
    visible
      .map((p) => `${p.id};${p.tags.join(',')};${p.coverUrl ?? ''};${(p.coverCandidates ?? []).length}`)
      .join('|') + `#${state.filterTag}#${state.tick}`;

  if (gridKey !== lastGridKey) {
    lastGridKey = gridKey;
    await Promise.all(
      visible.map(async (pin) => {
        cardSnapshots.set(pin.id, await latestSnapshots(pin.id, 30));
      }),
    );
    renderFilter(state);
    renderGrid(state, visible);
  }

  applySelection(state);
  renderFooter(state);
  document.getElementById('emptyState')!.hidden = state.pins.length > 0;
  document.querySelector('.grid-wrap')!.classList.toggle('is-empty', state.pins.length === 0);

  const sbKey = `${state.selectedId}|${state.sbView}|${state.tick}`;
  if (sbKey !== lastSidebarKey) {
    lastSidebarKey = sbKey;
    await renderSidebarSlot(state);
  }
}

function renderFilter(state: AppState): void {
  const filter = document.getElementById('filter')!;
  const counts = new Map<string, number>();
  for (const pin of state.pins) {
    for (const tag of pin.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  filter.hidden = counts.size === 0;
  const items: string[] = [];
  items.push(
    `<span class="item all ${state.filterTag === null ? 'on' : ''}" data-tag="">all <span class="n">${state.pins.length}</span></span>`,
  );
  for (const [tag, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const on = state.filterTag === tag;
    items.push(
      `<span class="item ${on ? 'on' : ''}" data-tag="${escapeAttr(tag)}" style="${tagStyle(tag, on)}">${escapeText(tag)} <span class="n">${n}</span></span>`,
    );
  }
  filter.innerHTML = items.join('');
  // re-bind happens via delegated click on the container, set up in initFilter
}

function tagHue(tag: string): number {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function tagStyle(tag: string, on = false): string {
  const h = tagHue(tag);
  return on
    ? `background:hsl(${h} 50% 72%);color:hsl(${h} 60% 16%)`
    : `background:hsl(${h} 60% 88%);color:hsl(${h} 45% 28%)`;
}

let hasRenderedGrid = false;

function renderGrid(state: AppState, visible: Pin[]): void {
  const grid = document.getElementById('grid')!;
  const addTile = document.getElementById('addTile')!;

  // the fragment must be built inside the mutate callback: appending an
  // attached card to a fragment detaches it, so building it earlier would
  // leave withFlip nothing to measure and every card would count as new
  withFlip(
    grid,
    () => {
      const frag = document.createDocumentFragment();
      frag.append(addTile);
      for (const pin of visible) {
        let card = cardEls.get(pin.id);
        if (!card) {
          card = createCard(pin.id);
          cardEls.set(pin.id, card);
        }
        fillCard(card, pin, cardSnapshots.get(pin.id) ?? []);
        frag.append(card);
      }
      grid.replaceChildren(frag);
    },
    { animateNew: hasRenderedGrid },
  );
  hasRenderedGrid = true;

  const ids = new Set(state.pins.map((p) => p.id));
  for (const id of [...cardEls.keys()]) {
    if (!ids.has(id)) cardEls.delete(id);
  }
}

function createCard(id: string): HTMLElement {
  const tpl = document.getElementById('t-card') as HTMLTemplateElement;
  const node = tpl.content.cloneNode(true) as DocumentFragment;
  const card = node.querySelector<HTMLElement>('.card')!;
  card.dataset.id = id;
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.chip, .edit-btn, .tag-input, .card-actions, .cover-nav')) return;
    selectPin(id);
  });
  card.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('.tag-input')) return;
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement) === card) {
      e.preventDefault();
      selectPin(id);
    }
  });
  const editBtn = card.querySelector<HTMLButtonElement>('[data-edit]');
  editBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pin = pinById.get(id);
    if (pin) enterTagEdit(card, pin);
  });

  card.querySelectorAll<HTMLButtonElement>('[data-card-act]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pin = pinById.get(id);
      if (!pin) return;
      const act = btn.dataset.cardAct;
      if (act === 'open') {
        window.open(`https://github.com/${pin.owner}/${pin.repo}`, '_blank', 'noopener');
      } else if (act === 'details') {
        selectPin(id, 'detail');
      } else if (act === 'refresh') {
        btn.classList.add('busy');
        try {
          await refreshPin(pin, { force: true });
          setState({ pins: await listPins(), tick: getState().tick + 1 });
        } catch (err) {
          console.error(err);
        } finally {
          btn.classList.remove('busy');
        }
      } else if (act === 'unpin') {
        if (!confirm(`unpin ${pin.owner}/${pin.repo}?`)) return;
        await deletePin(pin.id);
        const state = getState();
        setState({
          pins: await listPins(),
          selectedId: state.selectedId === pin.id ? null : state.selectedId,
          tick: state.tick + 1,
        });
      }
    });
  });

  card.querySelector('[data-cover-prev]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pin = pinById.get(id);
    if (pin) void cycleCover(pin, -1);
  });
  card.querySelector('[data-cover-next]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pin = pinById.get(id);
    if (pin) void cycleCover(pin, 1);
  });

  return card;
}

async function cycleCover(pin: Pin, dir: 1 | -1): Promise<void> {
  const fresh = (await db.pins.get(pin.id)) ?? pin;
  const base = heroCandidates({ ...fresh, coverUrl: undefined });
  if (base.length < 2) return;
  const current = fresh.coverUrl ?? base[0];
  const idx = Math.max(0, base.indexOf(current));
  const next = base[(idx + dir + base.length) % base.length];
  await db.pins.update(fresh.id, { coverUrl: next });
  setState({ pins: await listPins() });
}

function applySelection(state: AppState): void {
  for (const [id, card] of cardEls) {
    card.classList.toggle('selected', id === state.selectedId);
  }
  if (state.selectedId && state.selectedId !== lastSelectedId) {
    const card = cardEls.get(state.selectedId);
    if (card) {
      card.classList.remove('pop');
      void card.offsetWidth;
      card.classList.add('pop');
      card.addEventListener('animationend', () => card.classList.remove('pop'), { once: true });
    }
  }
  lastSelectedId = state.selectedId;
  document.getElementById('layout')!.classList.toggle('sb-open', state.selectedId !== null);
}

function enterTagEdit(card: HTMLElement, pin: Pin): void {
  const tagsRow = card.querySelector<HTMLElement>('.tags-row');
  if (!tagsRow) return;
  const editBtn = tagsRow.querySelector<HTMLElement>('[data-edit]');
  if (editBtn) editBtn.style.visibility = 'hidden';

  const tagsEl = tagsRow.querySelector<HTMLElement>('.tags');
  if (!tagsEl) return;
  const original = pin.tags.join(', ');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.value = original;
  input.placeholder = 'tag1, tag2';
  input.draggable = false;
  tagsEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async (save: boolean) => {
    if (done) return;
    done = true;
    const value = input.value;
    input.replaceWith(tagsEl);
    if (editBtn) editBtn.style.visibility = '';
    if (save && value !== original) {
      const tags = value
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const dedup = Array.from(new Set(tags));
      await db.pins.update(pin.id, { tags: dedup });
      setState({ pins: await listPins(), tick: getState().tick + 1 });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    }
  });
  input.addEventListener('blur', () => commit(true));
}

function fillCard(card: HTMLElement, pin: Pin, snaps: Snapshot[]): void {
  applyTint(card, pin.id);
  setHero(card, pin);

  setText(card, '[data-owner]', `${pin.owner}/`);
  setText(card, '[data-repo]', pin.repo);
  card.setAttribute('aria-label', `${pin.owner}/${pin.repo}`);

  const latest = snaps[0];
  const dot = card.querySelector<HTMLElement>('[data-dot]');
  const ageEl = card.querySelector<HTMLElement>('[data-age]');
  const lastCommit = latest?.lastCommitAt;
  const health = healthFromLastCommit(lastCommit);
  if (dot) dot.className = `dot dot-${health}`;
  if (ageEl) ageEl.textContent = lastCommit ? `${relativeTime(lastCommit)} ago` : '--';
  const age = card.querySelector<HTMLElement>('.age');
  if (age) {
    age.dataset.tip = lastCommit
      ? `${HEALTH_LABEL[health]} repo . last commit ${relativeTime(lastCommit)} ago`
      : 'no commit data yet';
  }

  setText(card, '[data-desc]', pin.description ?? 'no description.');

  const sparkWrap = card.querySelector<HTMLElement>('.spark');
  if (sparkWrap) sparkWrap.hidden = snaps.length < 2;
  if (snaps.length >= 2) {
    const spark = buildSparkline(snaps);
    const oldest = snaps[snaps.length - 1];
    const windowLabel = relativeTime(oldest.takenAt);
    setText(card, '[data-spark-label]', windowLabel);
    if (sparkWrap) {
      sparkWrap.dataset.tip =
        spark.growthPct === null
          ? `star history over the last ${windowLabel} (${snaps.length} snapshots)`
          : `stars ${spark.growthPct >= 0 ? 'grew' : 'fell'} ${Math.abs(spark.growthPct).toFixed(1)}% over the last ${windowLabel} (${snaps.length} snapshots)`;
    }
    const sparkSvg = card.querySelector<SVGElement>('[data-spark]');
    if (sparkSvg) {
      const stroke = spark.flat ? '#8b919e' : '#15171c';
      sparkSvg.innerHTML = `<polyline points="${spark.points}" stroke="${stroke}" stroke-width="1" fill="none"/>`;
    }
    const growth = card.querySelector<HTMLElement>('[data-growth]');
    if (growth) {
      if (spark.growthPct === null) {
        growth.textContent = '--';
        growth.className = 'growth flat';
      } else {
        const pct = spark.growthPct;
        growth.textContent = `${Math.abs(pct).toFixed(1)}%`;
        growth.className = `growth ${pct === 0 ? 'flat' : pct < 0 ? 'neg' : ''}`;
      }
    }
  }

  setText(card, '[data-stars]', formatStars(latest?.stars));
  setText(card, '[data-forks]', formatStars(latest?.forks));
  setText(card, '[data-prs]', formatStars(latest?.openPRs));

  const fire = card.querySelector<HTMLElement>('[data-fire]');
  if (fire) {
    const hot = hotness(snaps);
    fire.hidden = hot < HOT_STARS;
    if (!fire.hidden) {
      fire.textContent = '\u{1F525}';
      fire.dataset.tip = `+${hot} stars since last snapshot`;
    }
  }

  const relLine = card.querySelector<HTMLElement>('[data-rel-line]');
  if (relLine) {
    const tag = latest?.latestReleaseTag;
    relLine.hidden = !tag;
    if (tag) {
      setText(relLine, '[data-rel-tag]', tag);
      const when = latest?.latestReleasePublishedAt
        ? `${relativeTime(latest.latestReleasePublishedAt)} ago`
        : '';
      setText(relLine, '[data-rel-when]', when);
      const isNew = !!(snaps[1]?.latestReleaseTag && snaps[1].latestReleaseTag !== tag);
      relLine.dataset.tip = isNew
        ? `latest release ${tag}${when ? `, published ${when}` : ''} . new since your last check (was ${snaps[1]!.latestReleaseTag})`
        : `latest release ${tag}${when ? `, published ${when}` : ''}`;
      const pill = relLine.querySelector<HTMLElement>('[data-rel-new]');
      if (pill) pill.hidden = !isNew;
    }
  }

  const tags = card.querySelector<HTMLElement>('[data-tags]');
  if (tags) {
    tags.replaceChildren();
    for (const tag of pin.tags) {
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = tag;
      span.style.cssText = tagStyle(tag);
      tags.append(span);
    }
  }
}

function applyTint(card: HTMLElement, id: string): void {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  card.style.setProperty('--tint', `hsl(${hue} 50% 96.5%)`);
  card.style.setProperty('--tint-2', `hsl(${hue} 45% 93%)`);
  card.style.setProperty('--tint-strong', `hsl(${hue} 50% 80%)`);
}

function setHero(card: HTMLElement, pin: Pin): void {
  const img = card.querySelector<HTMLImageElement>('img[data-hero]');
  if (!img) return;
  const candidates = heroCandidates(pin);
  const key = candidates.join('\n');
  if (img.dataset.key === key) return;
  img.dataset.key = key;
  loadHero(img, candidates, 0);
}

function loadHero(img: HTMLImageElement, candidates: string[], idx: number): void {
  if (idx >= candidates.length) {
    img.style.display = 'none';
    return;
  }
  img.style.display = '';
  img.classList.remove('logo', 'loaded');
  img.onerror = () => loadHero(img, candidates, idx + 1);
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const ar = h > 0 ? w / h : 1;
    if (h < 40 || ar > 5) {
      // a badge or divider slipped through the filter
      loadHero(img, candidates, idx + 1);
      return;
    }
    img.classList.toggle('logo', w < 440 || (ar > 0.7 && ar < 1.5));
    img.classList.add('loaded');
  };
  img.src = candidates[idx];
}

const HOT_STARS = 100;

// stars gained between the two most recent snapshots (they arrive sorted desc)
function hotness(snaps: Snapshot[]): number {
  if (snaps.length < 2) return 0;
  return snaps[0].stars - snaps[1].stars;
}

function renderFooter(state: AppState): void {
  const footer = document.getElementById('footer')!;
  const parts: string[] = [];
  parts.push(`${state.pins.length} pins`);
  parts.push('local browser');
  if (state.pins.length > 0) parts.push('drag to rearrange');
  if (state.rateRemaining !== null && state.rateLimit !== null) {
    parts.push(`api ${state.rateRemaining}/${state.rateLimit}`);
  }
  footer.innerHTML =
    `<span class="brand"><img class="logo" src="/favicon-32.png" alt="">gh.pin</span> . ${parts.join(' . ')} . ` +
    `<button data-settings type="button">settings</button>`;
}

async function renderSidebarSlot(state: AppState): Promise<void> {
  const slot = document.getElementById('sbContent')!;
  if (!state.selectedId) {
    slot.replaceChildren();
    const p = document.createElement('p');
    p.className = 'sb-empty';
    p.textContent = 'click a card to inspect';
    slot.append(p);
    return;
  }
  const pin = state.pins.find((p) => p.id === state.selectedId);
  if (!pin) {
    slot.replaceChildren();
    return;
  }
  const ctx = await buildSidebarContext(pin);
  renderSidebar(slot, ctx);
}

function setText(root: ParentNode, sel: string, value: string): void {
  const el = root.querySelector(sel);
  if (el) el.textContent = value;
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
