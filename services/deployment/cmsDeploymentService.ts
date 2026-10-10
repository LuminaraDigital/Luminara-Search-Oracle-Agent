/**
 * Luminara 1-Click CMS & GitHub Deployment Service
 * Sends remediated Schema.org markup to a CMS, or opens a pull request with it.
 *
 * A result reports only what was checked. A WordPress deploy is "deployed" when the page was
 * read before and after the request and the schema appeared in its source, not when the API
 * answered 200. Webflow says its API accepted the request. The pull request path says what
 * was added. Both say what still has to happen before anything reaches the site.
 */

import {
  schemaSafetyGate,
  type GateSeverity,
  type SchemaSafetyIssue,
  type SchemaSafetyResult,
} from './schemaSafetyGate';
import { validateCmsEndpoint } from './cmsEndpointValidator';
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export { validateCmsEndpoint, type CmsEndpointValidation } from './cmsEndpointValidator';

export type CmsPlatform = 'wordpress' | 'webflow' | 'shopify' | 'github_pr' | 'script_tag';

export interface DeploymentConfig {
  platform: CmsPlatform;
  endpoint?: string;
  authToken?: string; // WordPress App Password, Webflow API Token, Shopify Access Token, or GitHub PAT
  siteId?: string;    // Webflow site ID, WordPress page ID, or Shopify theme ID
  repoOwner?: string; // GitHub repository owner
  repoName?: string;  // GitHub repository name
  targetBranch?: string; // Default: 'main'
  filePath?: string;     // Default: 'app/layout.tsx' or 'index.html'
}

export interface RemediationPayload {
  domain: string;
  pageUrl?: string;
  title: string;
  schemaJsonLd: string;
  originalSchema?: string;
  contentPatch?: {
    originalText: string;
    optimizedText: string;
    location: string;
  };
}

export interface DeploymentResult {
  success: boolean;
  platform: CmsPlatform;
  deploymentId: string;
  message: string;
  /** True only when a read-back fetch found the schema in the page source. */
  seenInPageSource?: boolean;
  /** True when the schema was on the page before anything was sent, so nothing was sent. */
  alreadyOnPage?: boolean;
  targetRef?: string;
  liveUrl?: string;
  prUrl?: string;
  diffSummary: {
    linesAdded: number;
    linesRemoved: number;
  };
  timestamp: number;
  validationErrors?: SchemaSafetyIssue[];
  gateSeverity?: GateSeverity;
}

type SchemaReadBack =
  | { status: 'found' }
  | { status: 'not_found' }
  | { status: 'unreadable'; reason: string };

const STORAGE_KEY_CREDS = 'luminara_cms_credentials';
// v2: entries written before the read-back existed recorded deployments nobody had checked,
// so the history list starts again rather than repeat them.
const STORAGE_KEY_HISTORY = 'luminara_deployment_history_v2';

/** What a call that was not accepted did, in words a user can read. */
const outcome = (res: Response | null): string => (res ? `answered HTTP ${res.status}` : 'could not be reached');

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Null when the bytes are not valid UTF-8, so a binary or legacy-encoded file is never rewritten. */
function base64ToUtf8(base64: string): string | null {
  try {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export class CmsDeploymentService {
  private static instance: CmsDeploymentService;

  private constructor() {}

  public static getInstance(): CmsDeploymentService {
    if (!CmsDeploymentService.instance) {
      CmsDeploymentService.instance = new CmsDeploymentService();
    }
    return CmsDeploymentService.instance;
  }

  public getSavedConfig(platform: CmsPlatform): Partial<DeploymentConfig> {
    if (typeof window === 'undefined') return {};
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDS) || '{}');
      return all[platform] || {};
    } catch {
      return {};
    }
  }

  public saveConfig(platform: CmsPlatform, config: Partial<DeploymentConfig>): void {
    if (typeof window === 'undefined') return;
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDS) || '{}');
      all[platform] = config;
      localStorage.setItem(STORAGE_KEY_CREDS, JSON.stringify(all));
    } catch (e) {
      console.warn('Failed to save CMS config', e);
    }
  }

  /**
   * The token and the rest of the form stay in memory unless the user asked for them to be
   * remembered on this device. Without that, nothing is stored and an earlier copy is removed.
   */
  public rememberConfig(platform: CmsPlatform, config: Partial<DeploymentConfig>, remember: boolean): void {
    if (remember) {
      this.saveConfig(platform, config);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDS) || '{}');
      if (!(platform in all)) return;
      delete all[platform];
      localStorage.setItem(STORAGE_KEY_CREDS, JSON.stringify(all));
    } catch (e) {
      console.warn('Failed to clear CMS config', e);
    }
  }

  public getDeploymentHistory(): DeploymentResult[] {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
    } catch {
      return [];
    }
  }

  private recordDeployment(res: DeploymentResult): void {
    if (typeof window === 'undefined') return;
    try {
      const prev = this.getDeploymentHistory();
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify([res, ...prev.slice(0, 40)]));
    } catch (e) {
      console.warn('Failed to record deployment history', e);
    }
  }

  /**
   * Schema safety gate before any remote CMS / GitHub deploy.
   */
  private assertSafeToDeploy(payload: RemediationPayload): SchemaSafetyResult {
    return schemaSafetyGate.validate(payload.schemaJsonLd ?? '');
  }

  /** Public alias for UI preflight checks. */
  public validatePayload(payload: RemediationPayload): SchemaSafetyResult {
    return this.assertSafeToDeploy(payload);
  }

  private gateBlockedResult(platform: CmsPlatform, gate: SchemaSafetyResult): DeploymentResult {
    return {
      success: false,
      platform,
      deploymentId: `gate-${Date.now()}`,
      message: `Schema safety gate blocked deploy (${gate.severity}): ${gate.issues.map((i) => i.message).join(' ')}`,
      validationErrors: gate.issues,
      gateSeverity: gate.severity,
      diffSummary: { linesAdded: 0, linesRemoved: 0 },
      timestamp: Date.now(),
    };
  }

  /**
   * Generates a unified diff representation for before and after states
   */
  public generateUnifiedDiff(originalContent: string, newContent: string, fileName = 'schema.json'): string {
    const origLines = (originalContent || '// [No existing Schema.org markup detected on target page]').split('\n');
    const newLines = newContent.split('\n');
    
    const diff: string[] = [
      `--- a/${fileName} (Existing State)`,
      `+++ b/${fileName} (Luminara AEO Remediated)`,
      '@@ -1 +1 @@',
    ];

    origLines.forEach(l => diff.push(`- ${l}`));
    newLines.forEach(l => diff.push(`+ ${l}`));

    return diff.join('\n');
  }

  /**
   * Asks the Worker to fetch the page and say whether the schema is in its source: a browser
   * cannot read another site's HTML. Only the page URL and the schema are sent, never the CMS
   * credentials. Anything short of a clear yes or no is `unreadable`.
   */
  private async readBackSchema(pageUrl: string, schemaJsonLd: string): Promise<SchemaReadBack> {
    const base = apiBase();
    if (!base) return { status: 'unreadable', reason: 'This build has no Luminara server to read the page with.' };
    try {
      const res = await workerFetchWithAuthRetry(`${base}/api/deploy/readback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pageUrl, schemaJsonLd }),
      });
      if (res.status === 401) return { status: 'unreadable', reason: 'Sign in so the page can be read back.' };
      const data = (await res.json().catch(() => null)) as { ok?: unknown; found?: unknown; error?: unknown } | null;
      if (res.ok && data?.ok === true && typeof data.found === 'boolean') {
        return { status: data.found ? 'found' : 'not_found' };
      }
      const reason = typeof data?.error === 'string' && data.error ? data.error : 'The page check gave no answer.';
      return { status: 'unreadable', reason };
    } catch {
      return { status: 'unreadable', reason: 'The page check could not be reached.' };
    }
  }

  /**
   * Reads the page, sends the schema to WordPress via REST API, then reads the page again.
   * "Deployed" needs both reads: the schema absent before the request and present after it.
   * If the first read fails nothing is sent, because a change could not be told apart from
   * a schema that was there all along.
   */
  public async deployToWordPress(config: DeploymentConfig, payload: RemediationPayload): Promise<DeploymentResult> {
    const gate = this.assertSafeToDeploy(payload);
    if (!gate.okToDeploy) return this.gateBlockedResult('wordpress', gate);

    // Never derive the endpoint from the audited domain: an audit must not steer credentials to another site.
    const endpointCheck = validateCmsEndpoint(config.endpoint ?? '');
    if (!endpointCheck.ok) {
      return {
        success: false,
        platform: 'wordpress',
        deploymentId: `err-${Date.now()}`,
        message: `WordPress site URL rejected: ${endpointCheck.error}`,
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
      };
    }
    const baseEndpoint = endpointCheck.url;
    const apiUrl = `${baseEndpoint}/wp-json/wp/v2/settings`;
    const token = config.authToken || '';
    const schemaJson = gate.canonicalJson ?? '';

    try {
      if (!token) {
        throw new Error('WordPress Application Password or Basic Auth Token is required.');
      }

      const pageUrl = `${baseEndpoint}/`;
      const finish = (fields: Pick<DeploymentResult, 'success' | 'message'> & Partial<DeploymentResult>): DeploymentResult => {
        const result: DeploymentResult = {
          platform: 'wordpress',
          deploymentId: `wp-${Date.now()}`,
          diffSummary: { linesAdded: 0, linesRemoved: 0 },
          timestamp: Date.now(),
          gateSeverity: gate.severity,
          validationErrors: gate.issues.length ? gate.issues : undefined,
          ...fields,
        };
        this.recordDeployment(result);
        return result;
      };

      // The page as it is now. Without it, a schema that was already there would read as deployed.
      const before = await this.readBackSchema(pageUrl, schemaJson);
      if (before.status === 'unreadable') {
        return finish({
          success: false,
          seenInPageSource: false,
          message: `Nothing was sent to WordPress. The page has to be read before and after the request to confirm a change, and it could not be read. ${before.reason}`,
        });
      }
      if (before.status === 'found') {
        return finish({
          success: true,
          seenInPageSource: true,
          alreadyOnPage: true,
          message: 'This schema is already on the page. Nothing was changed.',
        });
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(token)}`,
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          luminara_aeo_schema: schemaJson,
        }),
      }).catch(() => null);

      if (!response?.ok) {
        return finish({
          success: false,
          seenInPageSource: false,
          message: `WordPress did not accept the request: ${baseEndpoint} ${outcome(response)}.`,
        });
      }

      // A 200 says WordPress took the request. WordPress drops a setting that no plugin
      // registered, so only the page itself can say whether anything changed.
      const after = await this.readBackSchema(pageUrl, schemaJson);
      if (after.status === 'found') {
        return finish({
          success: true,
          seenInPageSource: true,
          message: `Deployed. The schema was not on ${pageUrl} before the request, and a fresh fetch found it in the page source afterwards.`,
          liveUrl: pageUrl,
          diffSummary: {
            linesAdded: payload.schemaJsonLd.split('\n').length,
            linesRemoved: (payload.originalSchema || '').split('\n').filter(Boolean).length,
          },
        });
      }
      return finish({
        success: false,
        seenInPageSource: false,
        message:
          after.status === 'not_found'
            ? 'WordPress accepted the request and the page did not change. This needs a plugin that registers the setting.'
            : `WordPress accepted the request, but the page could not be read back, so nothing is confirmed. ${after.reason}`,
      });
    } catch (e: any) {
      return {
        success: false,
        platform: 'wordpress',
        deploymentId: `err-${Date.now()}`,
        message: e?.message || 'WordPress deployment failed.',
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
      };
    }
  }

  /**
   * Asks Webflow's REST API v2 to add the schema to a site's custom code.
   * A 2xx is all that is known: the result says Webflow accepted the request, not that the
   * code is in place. Custom code reaches visitors only after the site is published.
   */
  public async deployToWebflow(config: DeploymentConfig, payload: RemediationPayload): Promise<DeploymentResult> {
    const gate = this.assertSafeToDeploy(payload);
    if (!gate.okToDeploy) return this.gateBlockedResult('webflow', gate);

    const siteId = config.siteId;
    const token = config.authToken;

    if (!token) {
      return {
        success: false,
        platform: 'webflow',
        deploymentId: `err-${Date.now()}`,
        message: 'Webflow API Bearer Token is required.',
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
        gateSeverity: gate.severity,
      };
    }

    try {
      const url = `https://api.webflow.com/v2/sites/${siteId || 'current'}/custom_code`;
      const scriptCode = `<script type="application/ld+json">\n${gate.canonicalJson ?? ''}\n</script>`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Version': '2.0.0',
        },
        body: JSON.stringify({
          scripts: [
            {
              location: 'header',
              version: '1.0.0',
              hostedLocation: 'custom',
              integrity: '',
              displayName: 'Luminara AEO Entity Graph',
              sourceCode: scriptCode,
            }
          ]
        }),
      }).catch(() => null);

      const success = Boolean(res?.ok);
      const deploymentId = `wf-${Date.now()}`;
      const result: DeploymentResult = {
        success,
        platform: 'webflow',
        deploymentId,
        message: success
          ? `Webflow accepted the request for site ${siteId || payload.domain}; publish the site to make it live.`
          : `Webflow did not accept the request: its API ${outcome(res)}.`,
        diffSummary: {
          linesAdded: success ? payload.schemaJsonLd.split('\n').length : 0,
          linesRemoved: 0,
        },
        timestamp: Date.now(),
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
      };

      this.recordDeployment(result);
      return result;
    } catch (e: any) {
      return {
        success: false,
        platform: 'webflow',
        deploymentId: `err-${Date.now()}`,
        message: e?.message || 'Webflow deployment failed.',
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
        gateSeverity: gate.severity,
      };
    }
  }

  /**
   * Opens a GitHub pull request that adds the JSON-LD block to a file that already exists.
   * The file is read first and written back whole, with the block placed before </head>.
   * If it cannot be read as text, or has no </head>, nothing is written at all.
   */
  public async deployToGitHubPR(config: DeploymentConfig, payload: RemediationPayload): Promise<DeploymentResult> {
    const gate = this.assertSafeToDeploy(payload);
    if (!gate.okToDeploy) {
      return this.gateBlockedResult('github_pr', gate);
    }

    const owner = config.repoOwner;
    const repo = config.repoName;
    const token = config.authToken;
    const branch = config.targetBranch || 'main';
    const filePath = config.filePath || 'app/layout.tsx';

    if (!owner || !repo || !token) {
      return {
        success: false,
        platform: 'github_pr',
        deploymentId: `err-${Date.now()}`,
        message: 'GitHub Owner, Repo name, and Personal Access Token (PAT) are required.',
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
      };
    }

    const prBranchName = `luminara/aeo-schema-${Date.now().toString().slice(-6)}`;
    const prTitle = `feat(seo): add Schema.org JSON-LD for ${payload.domain}`;
    const repoApi = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
    const contentsUrl = `${repoApi}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;

    const stop = (message: string): DeploymentResult => {
      const result: DeploymentResult = {
        success: false,
        platform: 'github_pr',
        deploymentId: `pr-${Date.now()}`,
        message,
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
      };
      this.recordDeployment(result);
      return result;
    };

    try {
      // 1. Read the base branch and the target file. Nothing is written until both are in hand.
      const refRes = await fetch(`${repoApi}/git/ref/heads/${branch}`, { headers }).catch(() => null);
      const baseSha = refRes?.ok ? (await refRes.json().catch(() => null))?.object?.sha : undefined;
      if (typeof baseSha !== 'string' || !baseSha) {
        return stop(`Nothing was written. Branch "${branch}" could not be read in ${owner}/${repo}: GitHub ${outcome(refRes)}.`);
      }

      // The file is read at the commit the new branch is cut from, so the two cannot disagree
      // if the base branch moves in between.
      const fileRes = await fetch(`${contentsUrl}?ref=${encodeURIComponent(baseSha)}`, { headers }).catch(() => null);
      if (!fileRes?.ok) {
        return stop(
          `Nothing was written. ${filePath} could not be read on branch "${branch}": GitHub ${outcome(fileRes)}. The schema is only added to a file that already exists.`,
        );
      }
      const file = await fileRes.json().catch(() => null);
      const original =
        file?.encoding === 'base64' && typeof file.content === 'string' && file.content ? base64ToUtf8(file.content) : null;
      if (typeof file?.sha !== 'string' || original === null) {
        return stop(`Nothing was written. ${filePath} could not be read as a text file.`);
      }
      const headClose = original.search(/<\/head\s*>/i);
      if (headClose < 0) {
        return stop(`Nothing was written. ${filePath} has no closing </head> tag to place the schema before.`);
      }

      // 2. Build the whole file: the original with one script block added before </head>.
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      const canonicalJson = gate.canonicalJson ?? '{}';
      const block = (/\.(tsx|jsx|js)$/i.test(filePath)
        ? `{/* Luminara AEO Schema Injection */}\n<script\n  type="application/ld+json"\n  dangerouslySetInnerHTML={{ __html: JSON.stringify(${canonicalJson}) }}\n/>\n`
        : `<script type="application/ld+json">\n${canonicalJson}\n</script>\n`
      ).replace(/\n/g, eol);
      const updated = original.slice(0, headClose) + block + original.slice(headClose);
      const linesAdded = updated.split('\n').length - original.split('\n').length;

      const types = [...new Set(gate.parsedTypes)];
      const prBody = [
        `## Schema.org JSON-LD for ${payload.domain}`,
        '',
        `This pull request adds one Schema.org JSON-LD script block to \`${filePath}\`, just before the closing \`</head>\` tag. Nothing else in the file changes.`,
        '',
        '### What was added',
        `- One \`application/ld+json\` script block: ${linesAdded} lines added, none removed`,
        ...(types.length ? [`- Schema.org types in it: ${types.join(', ')}`] : []),
        '',
        '### Before you merge',
        `- Luminara generated this markup for ${payload.domain}. Nobody has checked its facts. Read it and correct anything that is wrong.`,
        '- Nothing changes on the site until this pull request is merged and released.',
        '',
        '*Generated by Luminara Search Oracle Agent.*',
      ].join('\n');

      // 3. Create the branch, commit the whole file, open the pull request.
      const branchRes = await fetch(`${repoApi}/git/refs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${prBranchName}`, sha: baseSha }),
      }).catch(() => null);
      if (!branchRes?.ok) {
        return stop(
          `Nothing was committed. The new branch was not created: GitHub ${outcome(branchRes)}. Check that the token can write to ${owner}/${repo}.`,
        );
      }

      const commitRes = await fetch(contentsUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `chore(seo): add Luminara AEO JSON-LD graph`,
          content: utf8ToBase64(updated),
          sha: file.sha,
          branch: prBranchName,
        }),
      }).catch(() => null);
      if (!commitRes) {
        return stop(
          `GitHub did not answer the commit to ${filePath}, so it is not known whether branch ${prBranchName} holds the change. No pull request was opened.`,
        );
      }
      if (!commitRes.ok) {
        return stop(
          `Nothing was written to ${filePath}: GitHub ${outcome(commitRes)} to the commit. Branch ${prBranchName} was created and holds no change.`,
        );
      }

      const prRes = await fetch(`${repoApi}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: prTitle,
          body: prBody,
          head: prBranchName,
          base: branch,
        }),
      }).catch(() => null);
      const prUrl = prRes?.ok ? (await prRes.json().catch(() => null))?.html_url : undefined;
      if (typeof prUrl !== 'string' || !prUrl) {
        return stop(
          `The schema was committed to branch ${prBranchName}, but no pull request was confirmed: GitHub ${outcome(prRes)}. If none exists, open it from https://github.com/${owner}/${repo}/pull/new/${prBranchName}`,
        );
      }

      const result: DeploymentResult = {
        success: true,
        platform: 'github_pr',
        deploymentId: `pr-${Date.now()}`,
        message: `Pull request opened: ${prTitle}. Nothing changes on the site until it is merged and released.`,
        prUrl,
        targetRef: prBranchName,
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
        diffSummary: { linesAdded, linesRemoved: 0 },
        timestamp: Date.now(),
      };

      this.recordDeployment(result);
      return result;
    } catch (e: any) {
      return {
        success: false,
        platform: 'github_pr',
        deploymentId: `err-${Date.now()}`,
        message: e?.message || 'GitHub PR creation failed.',
        diffSummary: { linesAdded: 0, linesRemoved: 0 },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Generates an inline script tag that adds the schema when the page loads.
   * Nothing is hosted anywhere: the tag carries the schema itself.
   */
  public generateClientScriptTag(payload: RemediationPayload): string {
    const encoded = btoa(encodeURIComponent(payload.schemaJsonLd));
    return `<!-- CSP: allow script-src (nonce/hash preferred) for this injector; it creates a JSON-LD script via DOM appendChild. Do not rely on unsafe-inline if your CSP is strict. -->
<!-- Luminara AEO Injector (Zero-Code) -->
<script>
(function(){
  try {
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.text = decodeURIComponent(atob('${encoded}'));
    document.head.appendChild(s);
  } catch(e) { console.warn('Luminara AEO injection error', e); }
})();
</script>`;
  }
}

export const cmsDeploymentService = CmsDeploymentService.getInstance();
