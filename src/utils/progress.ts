import { ProgressSummary } from '../types';

export function calculateProgressPercentage(run: {
  totalPages?: number | null;
  discoveredPages?: number | null;
  cleanedPages?: number | null;
  skippedPages?: number | null;
  failedPages?: number | null;
  status?: string | null;
}): number {
  const total = run.totalPages || run.discoveredPages || 0;
  if (total === 0) {
    if (run.status === 'COMPLETED') return 100;
    return 0;
  }
  const processed = (run.cleanedPages || 0) + (run.skippedPages || 0) + (run.failedPages || 0);
  const pct = Math.min(100, Math.round((processed / total) * 100));
  return pct;
}

export { ProgressSummary };
