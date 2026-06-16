import { getSetting } from './db';

const GH = 'https://api.github.com';

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

let lastRate: RateLimit | null = null;
const rateListeners = new Set<(r: RateLimit) => void>();

export function getLastRate(): RateLimit | null {
  return lastRate;
}

export function onRateChange(fn: (r: RateLimit) => void): () => void {
  rateListeners.add(fn);
  return () => rateListeners.delete(fn);
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSetting<string>('githubToken');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${GH}${path}`, { ...init, headers });

  const limit = Number(res.headers.get('x-ratelimit-limit') ?? 0);
  const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? 0);
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000;
  if (limit) {
    lastRate = { limit, remaining, reset };
    rateListeners.forEach((fn) => fn(lastRate!));
  }

  return res;
}

export interface RepoInfo {
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  topics: string[];
  owner: { avatar_url: string };
}

export async function fetchRepo(owner: string, repo: string): Promise<RepoInfo> {
  const res = await gh(`/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error(`repo ${owner}/${repo}: ${res.status}`);
  return res.json();
}

export interface ReleaseInfo {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
}

export async function fetchReleases(owner: string, repo: string): Promise<ReleaseInfo[]> {
  const res = await gh(`/repos/${owner}/${repo}/releases?per_page=5`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`releases ${owner}/${repo}: ${res.status}`);
  }
  return res.json();
}

export interface CommitInfo {
  commit: { author: { date: string } | null; committer: { date: string } | null };
}

export async function fetchRecentCommits(
  owner: string,
  repo: string,
  sinceMs: number,
): Promise<CommitInfo[]> {
  const since = new Date(sinceMs).toISOString();
  const res = await gh(
    `/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=100`,
  );
  if (!res.ok) {
    if (res.status === 409) return [];
    throw new Error(`commits ${owner}/${repo}: ${res.status}`);
  }
  return res.json();
}

export async function fetchOpenPRCount(owner: string, repo: string): Promise<number> {
  const res = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=1`);
  if (!res.ok) throw new Error(`pulls ${owner}/${repo}: ${res.status}`);
  const link = res.headers.get('link');
  if (link) {
    const match = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
    if (match) return Number(match[1]);
  }
  const body = (await res.json()) as unknown[];
  return body.length;
}

export interface ReadmePayload {
  sha: string;
  markdown: string;
}

export async function fetchReadme(owner: string, repo: string): Promise<ReadmePayload | null> {
  const res = await gh(`/repos/${owner}/${repo}/readme`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`readme ${owner}/${repo}: ${res.status}`);
  }
  const body = (await res.json()) as { sha: string; content: string; encoding: string };
  if (body.encoding !== 'base64') return { sha: body.sha, markdown: body.content };
  const bin = atob(body.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const markdown = new TextDecoder('utf-8').decode(bytes);
  return { sha: body.sha, markdown };
}

export function ogImageUrl(owner: string, repo: string): string {
  return `https://opengraph.githubassets.com/auto/${owner}/${repo}`;
}
