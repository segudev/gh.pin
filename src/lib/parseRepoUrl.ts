export interface RepoRef {
  owner: string;
  repo: string;
}

export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let owner: string | undefined;
  let repo: string | undefined;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
      const [o, r] = url.pathname.replace(/^\/+/, '').split('/');
      owner = o;
      repo = r;
    } catch {
      return null;
    }
  } else {
    const [o, r] = trimmed.split('/');
    owner = o;
    repo = r;
  }

  if (!owner || !repo) return null;
  const cleanRepo = repo.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(cleanRepo)) return null;
  return { owner: owner.toLowerCase(), repo: cleanRepo.toLowerCase() };
}

export function repoId(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}
