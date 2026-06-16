export type Health = 'ok' | 'warn' | 'bad';

const DAY_MS = 24 * 60 * 60 * 1000;

export function healthFromLastCommit(lastCommitAt: number | undefined): Health {
  if (!lastCommitAt) return 'bad';
  const ageDays = (Date.now() - lastCommitAt) / DAY_MS;
  if (ageDays <= 30) return 'ok';
  if (ageDays <= 180) return 'warn';
  return 'bad';
}
