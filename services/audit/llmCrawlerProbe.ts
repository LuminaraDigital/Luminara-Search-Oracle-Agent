/**
 * Best-effort fetch of llms.txt, robots.txt, and optional ai.txt through the Worker.
 * No API, no identity, or an unsafe URL becomes not_measured. Never a score.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { noteScoutReceipt } from '../referrals/scoutReceiptCapture';
import {
  evaluateLlmCrawlerReadiness,
  unevaluatedLlmCrawlerReport,
  type LlmCrawlerReport,
  type LlmCrawlerSnapshot,
} from './llmCrawlerReadiness';

export async function probeLlmCrawlerReadiness(pageUrl: string): Promise<LlmCrawlerReport> {
  const base = apiBase();
  if (!base || !pageUrl.trim()) return unevaluatedLlmCrawlerReport();
  try {
    const res = await workerFetchWithAuthRetry(
      `${base}/api/visibility/crawler-files?url=${encodeURIComponent(pageUrl)}`,
    );
    noteScoutReceipt(res.headers.get('x-scout-receipt'));
    if (!res.ok) return unevaluatedLlmCrawlerReport('Crawler files were not fetched. Not measured.');
    const data = (await res.json()) as { snapshot?: LlmCrawlerSnapshot | null };
    return evaluateLlmCrawlerReadiness(data.snapshot ?? null);
  } catch {
    return unevaluatedLlmCrawlerReport('Crawler files were not fetched. Not measured.');
  }
}
