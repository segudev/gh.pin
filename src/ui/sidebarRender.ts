import { latestSnapshots, listReleases, type Pin, type Snapshot, type Release } from '../db';
import { relativeTime, formatStars, isoDate } from '../lib/time';
import { renderMarkdown } from '../lib/markdown';
import { loadOrFetchReadme } from '../snapshots';
import { getState } from '../state';

export interface SidebarContext {
  pin: Pin;
  snapshots: Snapshot[];
  releases: Release[];
  view: 'readme' | 'detail';
}

export async function buildSidebarContext(pin: Pin): Promise<SidebarContext> {
  const [snapshots, releases] = await Promise.all([
    latestSnapshots(pin.id, 60),
    listReleases(pin.id, 10),
  ]);
  return { pin, snapshots, releases, view: getState().sbView };
}

export function renderSidebar(container: HTMLElement, ctx: SidebarContext): void {
  const tpl = document.getElementById('t-sidebar-default') as HTMLTemplateElement;
  container.replaceChildren(tpl.content.cloneNode(true));

  const readmeWrap = container.querySelector<HTMLElement>('[data-readme]')!;
  const detailWrap = container.querySelector<HTMLElement>('[data-detail]')!;
  readmeWrap.style.display = ctx.view === 'readme' ? '' : 'none';
  detailWrap.style.display = ctx.view === 'detail' ? '' : 'none';

  if (ctx.view === 'readme') fillReadme(readmeWrap, ctx.pin);
  else fillDetail(detailWrap, ctx);
}

function fillDetail(wrap: HTMLElement, ctx: SidebarContext): void {
  const snaps = [...ctx.snapshots].sort((a, b) => a.takenAt - b.takenAt);
  const latest = snaps[snaps.length - 1];

  // star history
  const svg = wrap.querySelector<SVGElement>('[data-bigspark]');
  const note = wrap.querySelector<HTMLElement>('[data-history-note]');
  if (svg && note) {
    if (snaps.length < 2) {
      svg.style.display = 'none';
      note.hidden = false;
      note.textContent =
        snaps.length === 0
          ? 'no snapshots yet . hit refresh'
          : 'day 1 of history . a line appears tomorrow';
    } else {
      svg.style.display = '';
      note.hidden = true;
      svg.innerHTML = buildBigSpark(snaps);
    }
  }

  // activity
  const activity = wrap.querySelector<HTMLElement>('[data-activity]');
  if (activity) {
    const lines: string[] = [];
    lines.push(kv('commits 30d', latest ? String(latest.commitsLast30d) : '--'));
    lines.push(kv('open prs', formatStars(latest?.openPRs)));
    lines.push(kv('open issues', formatStars(latest?.openIssues)));
    if (latest?.latestReleaseTag) {
      const when = latest.latestReleasePublishedAt
        ? ` . ${relativeTime(latest.latestReleasePublishedAt)} ago`
        : '';
      lines.push(kv('last release', `${latest.latestReleaseTag}${when}`));
    }
    activity.textContent = lines.join('\n');
  }

  // mini releases
  const mini = wrap.querySelector<HTMLElement>('[data-rel-mini]');
  const relSec = wrap.querySelector<HTMLElement>('[data-sec-rel]');
  if (mini && relSec) {
    relSec.style.display = ctx.releases.length ? '' : 'none';
    mini.replaceChildren();
    for (const rel of ctx.releases.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'rel-row';
      const tag = document.createElement('span');
      tag.className = 'v';
      tag.textContent = rel.tag;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = relativeTime(rel.publishedAt);
      row.append(tag, when);
      mini.append(row);
    }
  }

  // snapshots table
  const pre = wrap.querySelector<HTMLElement>('[data-snaps]');
  const snapSec = wrap.querySelector<HTMLElement>('[data-sec-snaps]');
  if (pre && snapSec) {
    snapSec.style.display = snaps.length ? '' : 'none';
    const rows = snaps
      .slice(-10)
      .reverse()
      .map(
        (s) =>
          `${isoDate(s.takenAt)}  ${pad(formatStars(s.stars), 8)}${pad(formatStars(s.forks), 8)}${pad(formatStars(s.openIssues), 8)}`,
      );
    pre.textContent = `${'date'.padEnd(12)}${pad('stars', 8)}${pad('forks', 8)}${pad('issues', 8)}\n${rows.join('\n')}`;
  }
}

function buildBigSpark(snaps: Snapshot[]): string {
  const W = 300;
  const H = 56;
  const pad2 = 4;
  const values = snaps.map((s) => s.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(pad2 + (1 - (v - min) / span) * (H - pad2 * 2)).toFixed(1)}`)
    .join(' ');
  return `<polyline points="${pts}" stroke="#15171c" stroke-width="1.2" fill="none"/>`;
}

function kv(k: string, v: string): string {
  return `${k.padEnd(14)}${v}`;
}
function pad(s: string, n: number): string {
  return s.padStart(n);
}

function fillReadme(prose: HTMLElement, pin: Pin): void {
  prose.innerHTML = '<p style="color:var(--ink-3)">loading readme...</p>';
  loadOrFetchReadme(pin)
    .then((md) => {
      if (!md) {
        prose.innerHTML = '<p style="color:var(--ink-3)">no readme found.</p>';
        return;
      }
      prose.innerHTML = renderMarkdown(md);
    })
    .catch((err) => {
      prose.innerHTML = `<p style="color:var(--bad)">${(err as Error).message}</p>`;
    });
}
