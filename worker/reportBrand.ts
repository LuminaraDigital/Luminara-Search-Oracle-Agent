/**
 * Which brand a project's reports use, and the powered-by line for that account's plan.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId } from './workerUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { workspaceForAccount } from './clientWorkspace';
import { getProjectById } from './projectService';
import { openProject } from './tenantGate';
import { entitlementsFor } from '../services/plans/planEntitlements';
import {
  luminaraReportBrand,
  reportBrandFromWorkspace,
  safeLogoSrc,
  type ReportBrand,
} from '../services/reports/reportBrand';

export interface AccountReportBrand {
  brand: ReportBrand;
  hasWorkspace: boolean;
  whiteLabelPdf: boolean;
}

export async function reportBrandForAccount(env: Env, accountId: string): Promise<AccountReportBrand> {
  const sub = await getActiveSubscription(env, { id: accountId, source: 'firebase', accountId });
  const ent = entitlementsFor(sub?.plan);
  const showPoweredBy = !ent.whiteLabelRemovePoweredBy;
  const workspace = await workspaceForAccount(env, accountId);
  if (!workspace) {
    return { brand: luminaraReportBrand(showPoweredBy), hasWorkspace: false, whiteLabelPdf: ent.whiteLabelPdf };
  }
  return {
    brand: reportBrandFromWorkspace(workspace, showPoweredBy),
    hasWorkspace: true,
    whiteLabelPdf: ent.whiteLabelPdf,
  };
}

export interface ShareBranding {
  agencyName?: string;
  logoUrl?: string;
  accentColor?: string;
  preparedBy?: string;
  clientName?: string;
  showPoweredBy?: boolean;
}

export async function resolveShareBranding(
  env: Env,
  caller: HostedIdentity,
  projectId: string | undefined,
  supplied: ShareBranding | undefined,
): Promise<
  | { ok: true; projectId: string | null; branding?: ShareBranding }
  | { ok: false; status: number; error: string }
> {
  let accountId = billingId(caller);
  let linked: string | null = null;
  if (projectId) {
    const opened = await openProject(env, caller, projectId, false);
    if (!opened.ok) return opened;
    accountId = opened.accountId;
    linked = opened.project.id;
  }
  const live = await reportBrandForAccount(env, accountId);
  if (linked && live.hasWorkspace) {
    return {
      ok: true,
      projectId: linked,
      branding: {
        agencyName: live.brand.displayName,
        logoUrl: live.brand.logoUrl || undefined,
        accentColor: live.brand.primaryColour,
        clientName: supplied?.clientName,
        preparedBy: supplied?.preparedBy,
        showPoweredBy: live.brand.showPoweredBy,
      },
    };
  }
  let branding = supplied;
  if (!live.whiteLabelPdf) branding = undefined;
  else if (branding?.logoUrl) {
    const safe = safeLogoSrc(branding.logoUrl);
    branding = { ...branding, logoUrl: safe || undefined, showPoweredBy: live.brand.showPoweredBy };
  } else if (branding) {
    branding = { ...branding, showPoweredBy: live.brand.showPoweredBy };
  }
  if (!branding && !live.brand.showPoweredBy) branding = { showPoweredBy: false };
  return { ok: true, projectId: linked, branding };
}

/** Live brand for a stored share. A project in a workspace wins over anything the client sent. */
export async function presentShareBranding(
  env: Env,
  ownerAccountId: string,
  projectId: string | null,
  stored: ShareBranding | undefined,
): Promise<ShareBranding | undefined> {
  const projectAccount = projectId ? (await getProjectById(env, projectId))?.accountId : null;
  const accountId = projectAccount || ownerAccountId;
  const live = await reportBrandForAccount(env, accountId);
  if (projectId && projectAccount && live.hasWorkspace) {
    return {
      agencyName: live.brand.displayName,
      logoUrl: live.brand.logoUrl || undefined,
      accentColor: live.brand.primaryColour,
      clientName: stored?.clientName,
      preparedBy: stored?.preparedBy,
      showPoweredBy: live.brand.showPoweredBy,
    };
  }
  if (!stored) return live.brand.showPoweredBy ? undefined : { showPoweredBy: false };
  return { ...stored, showPoweredBy: live.brand.showPoweredBy };
}
