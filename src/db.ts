import Dexie, { type Table } from 'dexie';

export interface Pin {
  id: string;
  owner: string;
  repo: string;
  addedAt: number;
  order: number;
  tags: string[];
  description?: string;
  homepage?: string;
  avatarUrl?: string;
  coverUrl?: string;
  coverCandidates?: string[];
}

export interface Snapshot {
  id: string;
  repoId: string;
  takenAt: number;
  dayKey: string;
  stars: number;
  forks: number;
  openIssues: number;
  openPRs: number;
  lastCommitAt?: number;
  commitsLast30d: number;
  latestReleaseTag?: string;
  latestReleasePublishedAt?: number;
}

export interface Release {
  id: string;
  repoId: string;
  tag: string;
  name: string;
  publishedAt: number;
  bodyExcerpt: string;
}

export interface ReadmeRow {
  repoId: string;
  sha: string;
  markdown: string;
  fetchedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

class GhPinDB extends Dexie {
  pins!: Table<Pin, string>;
  snapshots!: Table<Snapshot, string>;
  releases!: Table<Release, string>;
  readmes!: Table<ReadmeRow, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('gh-pin');
    this.version(1).stores({
      pins: 'id, addedAt, order',
      snapshots: 'id, repoId, takenAt, [repoId+dayKey]',
      releases: 'id, repoId, publishedAt',
      readmes: 'repoId',
      settings: 'key',
    });
  }
}

export const db = new GhPinDB();

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function listPins(): Promise<Pin[]> {
  const pins = await db.pins.toArray();
  pins.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return pins;
}

export async function deletePin(id: string): Promise<void> {
  await db.transaction('rw', db.pins, db.snapshots, db.releases, db.readmes, async () => {
    await db.pins.delete(id);
    await db.snapshots.where('repoId').equals(id).delete();
    await db.releases.where('repoId').equals(id).delete();
    await db.readmes.delete(id);
  });
}

export async function latestSnapshots(repoId: string, limit = 60): Promise<Snapshot[]> {
  const rows = await db.snapshots.where('repoId').equals(repoId).toArray();
  rows.sort((a, b) => b.takenAt - a.takenAt);
  return rows.slice(0, limit);
}

export async function listReleases(repoId: string, limit = 5): Promise<Release[]> {
  const rows = await db.releases.where('repoId').equals(repoId).toArray();
  rows.sort((a, b) => b.publishedAt - a.publishedAt);
  return rows.slice(0, limit);
}
