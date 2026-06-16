import { db, type Pin, type Snapshot, latestSnapshots } from './db';
import {
  fetchRepo,
  fetchReleases,
  fetchRecentCommits,
  fetchOpenPRCount,
  fetchReadme,
} from './github';
import { isoDate } from './lib/time';
import { extractCoverCandidates } from './lib/cover';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function refreshPin(pin: Pin, opts: { force?: boolean } = {}): Promise<Snapshot> {
  const recent = await latestSnapshots(pin.id, 1);
  if (!opts.force && recent[0] && Date.now() - recent[0].takenAt < SIX_HOURS) {
    return recent[0];
  }

  const sinceMs = Date.now() - THIRTY_DAYS;
  const [info, releases, commits, openPRs] = await Promise.all([
    fetchRepo(pin.owner, pin.repo),
    fetchReleases(pin.owner, pin.repo),
    fetchRecentCommits(pin.owner, pin.repo, sinceMs),
    fetchOpenPRCount(pin.owner, pin.repo),
  ]);

  const lastCommitAt =
    commits[0]?.commit.committer?.date || commits[0]?.commit.author?.date
      ? new Date(
          (commits[0].commit.committer?.date ?? commits[0].commit.author?.date)!,
        ).getTime()
      : undefined;

  const latestRelease = releases[0];

  const takenAt = Date.now();
  const dayKey = isoDate(takenAt);
  const id = `${pin.id}@${dayKey}`;

  const snapshot: Snapshot = {
    id,
    repoId: pin.id,
    takenAt,
    dayKey,
    stars: info.stargazers_count,
    forks: info.forks_count,
    openIssues: info.open_issues_count - openPRs,
    openPRs,
    lastCommitAt,
    commitsLast30d: commits.length,
    latestReleaseTag: latestRelease?.tag_name,
    latestReleasePublishedAt: latestRelease
      ? new Date(latestRelease.published_at).getTime()
      : undefined,
  };

  await db.transaction('rw', db.pins, db.snapshots, db.releases, async () => {
    await db.snapshots.put(snapshot);
    await db.pins.update(pin.id, {
      description: info.description ?? undefined,
      homepage: info.homepage ?? undefined,
      avatarUrl: info.owner.avatar_url,
    });
    if (releases.length) {
      await db.releases.bulkPut(
        releases.map((r) => ({
          id: `${pin.id}@${r.tag_name}`,
          repoId: pin.id,
          tag: r.tag_name,
          name: r.name ?? r.tag_name,
          publishedAt: new Date(r.published_at).getTime(),
          bodyExcerpt: (r.body ?? '').trim(),
        })),
      );
    }
  });

  return snapshot;
}

export async function loadOrFetchReadme(pin: Pin): Promise<string | null> {
  const cached = await db.readmes.get(pin.id);
  if (cached) {
    if (pin.coverCandidates === undefined) await storeCoverCandidates(pin, cached.markdown);
    return cached.markdown;
  }
  const fresh = await fetchReadme(pin.owner, pin.repo);
  if (!fresh) {
    await db.pins.update(pin.id, { coverCandidates: [] });
    return null;
  }
  await db.readmes.put({
    repoId: pin.id,
    sha: fresh.sha,
    markdown: fresh.markdown,
    fetchedAt: Date.now(),
  });
  await storeCoverCandidates(pin, fresh.markdown);
  return fresh.markdown;
}

async function storeCoverCandidates(pin: Pin, markdown: string): Promise<void> {
  const coverCandidates = extractCoverCandidates(markdown, pin.owner, pin.repo);
  await db.pins.update(pin.id, { coverCandidates });
}
