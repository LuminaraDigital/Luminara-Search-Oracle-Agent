/**
 * Brand for the project on screen. The worker decides workspace versus Luminara.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { ReportBrand } from './reportBrand';

export async function fetchProjectReportBrand(projectId: string): Promise<ReportBrand | null> {
  const base = apiBase();
  if (!base || !projectId) return null;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { reportBrand?: Partial<ReportBrand> };
    const brand = body.reportBrand;
    if (!brand || (brand.kind !== 'workspace' && brand.kind !== 'luminara')) return null;
    if (typeof brand.displayName !== 'string' || typeof brand.primaryColour !== 'string') return null;
    return {
      kind: brand.kind,
      displayName: brand.displayName,
      logoUrl: typeof brand.logoUrl === 'string' ? brand.logoUrl : null,
      primaryColour: brand.primaryColour,
      showPoweredBy: brand.showPoweredBy !== false,
    };
  } catch {
    return null;
  }
}
