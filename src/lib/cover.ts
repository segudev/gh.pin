// Extracts hero-image candidates from a README, in document order.
// Badges and CI shields are filtered out; relative paths resolve against
// raw.githubusercontent.com; dark-mode variants are deprioritized behind
// a light-swapped guess so the cascade can try the light twin first.

import type { Pin } from '../db';
import { ogImageUrl } from '../github';

// Fallback chain for the card hero: manual pick, then readme candidates,
// then the GitHub OG card, then the owner avatar.
export function heroCandidates(pin: Pin): string[] {
  const list: string[] = [];
  if (pin.coverUrl) list.push(pin.coverUrl);
  list.push(...(pin.coverCandidates ?? []));
  list.push(ogImageUrl(pin.owner, pin.repo));
  if (pin.avatarUrl) list.push(pin.avatarUrl);
  return [...new Set(list)];
}

const BADGE_RE =
  /shields\.io|badgen\.net|badge|\/actions\/workflows\/|star-history\.com|contrib\.rocks|deepwiki|opencollective|sponsors\.svg|codecov|coveralls|circleci|travis-ci|gitpod|herokucdn|snyk/i;

const IMG_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<img[^>]*\ssrc=["']([^"']+)["']/gi;

export function extractCoverCandidates(markdown: string, owner: string, repo: string): string[] {
  const raw: string[] = [];
  let m: RegExpExecArray | null;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(markdown)) && raw.length < 40) {
    const u = (m[1] ?? m[2] ?? '').trim();
    if (u) raw.push(u);
  }

  const light: string[] = [];
  const dark: string[] = [];
  for (const u of raw) {
    if (u.startsWith('data:')) continue;
    if (/#gh-dark-mode-only/i.test(u)) continue;
    const resolved = resolveUrl(u.replace(/#gh-light-mode-only/i, ''), owner, repo);
    if (!resolved || BADGE_RE.test(resolved)) continue;
    if (/(^|[-_./])dark/i.test(fileName(resolved))) {
      const swapped = resolved.replace(/dark/gi, 'light');
      if (swapped !== resolved) dark.push(swapped);
      dark.push(resolved);
    } else {
      light.push(resolved);
    }
  }
  return dedupe([...light, ...dark]).slice(0, 6);
}

function resolveUrl(u: string, owner: string, repo: string): string | null {
  if (/^https?:\/\//i.test(u)) {
    // github.com blob/raw page links -> raw content host
    const blob = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^?#]+)/i);
    if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
    return u;
  }
  if (u.startsWith('//')) return `https:${u}`;
  const path = u.replace(/^\.?\//, '');
  if (!path) return null;
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;
}

function fileName(u: string): string {
  try {
    return new URL(u).pathname.split('/').pop() ?? '';
  } catch {
    return u;
  }
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}
