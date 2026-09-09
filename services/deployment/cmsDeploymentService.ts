/**
 * Luminara Autonomous 1-Click CMS & GitHub Deployment Service
 * Bridges diagnostic AEO findings into live production code updates.
 */

import {
  schemaSafetyGate,
  type GateSeverity,
  type SchemaSafetyIssue,
  type SchemaSafetyResult,
} from './schemaSafetyGate';

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

const STORAGE_KEY_CREDS = 'luminara_cms_credentials';
const STORAGE_KEY_HISTORY = 'luminara_deployment_history';

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
   * Deploys directly to WordPress via REST API
   */
  public async deployToWordPress(config: DeploymentConfig, payload: RemediationPayload): Promise<DeploymentResult> {
    const gate = this.assertSafeToDeploy(payload);
    if (!gate.okToDeploy) return this.gateBlockedResult('wordpress', gate);

    const baseEndpoint = (config.endpoint || `https://${payload.domain}`).replace(/\/$/, '');
    const apiUrl = `${baseEndpoint}/wp-json/wp/v2/settings`;
    const token = config.authToken || '';

    try {
      if (!token) {
        throw new Error('WordPress Application Password or Basic Auth Token is required.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(token)}`,
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          luminara_aeo_schema: payload.schemaJsonLd,
        }),
      }).catch(() => null);

      const success = Boolean(response?.ok);
      const deploymentId = `wp-${Date.now()}`;
      const result: DeploymentResult = {
        success,
        platform: 'wordpress',
        deploymentId,
        message: success
          ? `Schema.org @graph successfully deployed to WordPress header for ${payload.domain}.`
          : `WordPress endpoint did not accept the payload (${baseEndpoint}). HTTP ${response?.status ?? 'unreachable'}.`,
        liveUrl: baseEndpoint,
        diffSummary: {
          linesAdded: payload.schemaJsonLd.split('\n').length,
          linesRemoved: (payload.originalSchema || '').split('\n').filter(Boolean).length,
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
   * Deploys directly to Webflow via Webflow REST API v2
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
      const scriptCode = `<script type="application/ld+json">\n${payload.schemaJsonLd}\n</script>`;

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
          ? `Custom Schema.org code successfully published to Webflow site (${siteId || payload.domain}).`
          : `Webflow API rejected or unreachable. HTTP ${res?.status ?? 'unreachable'}.`,
        diffSummary: {
          linesAdded: payload.schemaJsonLd.split('\n').length,
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
   * Generates a production GitHub Pull Request containing the JSON-LD patch
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
    const prTitle = `feat(seo): Deploy Luminara AEO Schema.org Entity Graph for ${payload.domain}`;
    const prBody = `## Luminara Autonomous AEO Remediation
This Pull Request automatically injects authoritative Schema.org JSON-LD entity markup to improve visibility in Google AI Overviews, Perplexity, and ChatGPT Search.

### Changes:
- Injected Schema.org \`@graph\` into \`${filePath}\`
- Anchored on verified entity nodes and USP propositions
- Remediated competitor visibility gap for **${payload.domain}**

*Generated by Luminara Search Oracle Agent.*`;

    try {
      // 1. Get base branch ref SHA
      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      
      let baseSha = 'mock-sha';
      if (refRes.ok) {
        const refData = await refRes.json();
        baseSha = refData.object.sha;

        // 2. Create new branch
        await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
          method: 'POST',
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
          body: JSON.stringify({ ref: `refs/heads/${prBranchName}`, sha: baseSha }),
        });
      }

      // 3. Create or update file content in branch
      const patchContent = `\n{/* Luminara AEO Schema Injection */}\n<script\n  type="application/ld+json"\n  dangerouslySetInnerHTML={{ __html: JSON.stringify(${payload.schemaJsonLd}) }}\n/>\n`;
      
      await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify({
          message: `chore(seo): add Luminara AEO JSON-LD graph`,
          content: btoa(patchContent),
          branch: prBranchName,
        }),
      }).catch(() => null);

      // 4. Open Pull Request
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify({
          title: prTitle,
          body: prBody,
          head: prBranchName,
          base: branch,
        }),
      }).catch(() => null);

      const success = Boolean(prRes?.ok);
      const prUrl = success ? (await prRes!.json()).html_url : `https://github.com/${owner}/${repo}/pull/new/${prBranchName}`;
      const deploymentId = `pr-${Date.now()}`;

      const result: DeploymentResult = {
        success,
        platform: 'github_pr',
        deploymentId,
        message: success
          ? `GitHub Pull Request successfully opened: ${prTitle}`
          : `GitHub PR creation failed or unreachable for ${owner}/${repo}.`,
        prUrl,
        targetRef: prBranchName,
        gateSeverity: gate.severity,
        validationErrors: gate.issues.length ? gate.issues : undefined,
        diffSummary: {
          linesAdded: payload.schemaJsonLd.split('\n').length + 4,
          linesRemoved: 0,
        },
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
   * Generates a zero-code dynamic CDN script tag that auto-injects the schema
   */
  public generateClientScriptTag(payload: RemediationPayload): string {
    const encoded = btoa(encodeURIComponent(payload.schemaJsonLd));
    return `<!-- CSP: allow script-src (nonce/hash preferred) for this injector; it creates a JSON-LD script via DOM appendChild. Do not rely on unsafe-inline if your CSP is strict. -->
<!-- Luminara AEO Autonomous Injector (Zero-Code) -->
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
