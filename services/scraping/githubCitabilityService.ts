/**
 * GitHub Repository GEO / AEO Citability Engine
 *
 * Specialised scraper & evaluator for GitHub repositories.
 * Leverages zero-auth raw content endpoints (raw.githubusercontent.com) and public metadata
 * to audit AI citability (llms.txt, README answer extractability, code clarity, and license).
 */

import { contentDistiller, DistilledContentResult } from './contentDistiller';
import { ScrapedPageEvidence } from './unifiedScraper';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubRepoMetadata {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  homepage?: string;
  license?: string;
  topics: string[];
  defaultBranch: string;
}

export interface GitHubCitabilityEvaluation {
  repo: GitHubRepoRef;
  metadata?: GitHubRepoMetadata;
  hasLlmsTxt: boolean;
  hasLlmsFullTxt: boolean;
  llmsTxtSnippet?: string;
  readmeWordCount: number;
  firstAnswerBlock: string;
  firstAnswerWordCount: number;
  hasAeoAnswerTarget: boolean; // 40-70 words declarative solution
  hasCodeBlocks: boolean;
  hasFencedSyntaxTags: boolean;
  hasLicense: boolean;
  hasHomepageDocs: boolean;
  citabilityScore: number; // 0-100
  recommendations: string[];
  suggestedLlmsTxt: string;
}

const RESERVED_GITHUB_NAMES = new Set([
  'features',
  'pricing',
  'join',
  'login',
  'explore',
  'topics',
  'trending',
  'collections',
  'events',
  'readme',
  'settings',
  'notifications',
  'marketplace',
  'pulls',
  'issues',
  'codespaces',
  'sponsors',
  'security',
  'contact',
  'about',
]);

export class GitHubCitabilityService {
  private static instance: GitHubCitabilityService;

  private constructor() {}

  public static getInstance(): GitHubCitabilityService {
    if (!GitHubCitabilityService.instance) {
      GitHubCitabilityService.instance = new GitHubCitabilityService();
    }
    return GitHubCitabilityService.instance;
  }

  /**
   * Parses a raw URL to extract GitHub owner and repo if valid.
   */
  public parseGitHubUrl(rawUrl: string): GitHubRepoRef | null {
    if (!rawUrl) return null;
    const clean = rawUrl
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '');

    if (!clean.toLowerCase().startsWith('github.com/')) return null;

    const parts = clean.split('/').filter(Boolean);
    if (parts.length < 3) return null; // needs at least ['github.com', 'owner', 'repo']

    const owner = parts[1];
    let repo = parts[2];

    if (RESERVED_GITHUB_NAMES.has(owner.toLowerCase())) return null;

    // Strip .git suffix and sub-paths like /tree/main, /blob/master, etc.
    repo = repo.replace(/\.git$/i, '');
    if (!repo) return null;

    return { owner, repo };
  }

  /**
   * Fetches raw README.md, llms.txt, and repository metadata.
   */
  public async fetchRepoContent(ref: GitHubRepoRef): Promise<{
    readme: string;
    llmsTxt: string | null;
    llmsFullTxt: string | null;
    metadata?: GitHubRepoMetadata;
  }> {
    const { owner, repo } = ref;
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;

    // 1. Fetch README (try README.md, then readme.md)
    let readme = '';
    try {
      const readmeRes = await fetch(`${rawBase}/README.md`, {
        headers: { Accept: 'text/plain, text/markdown' },
      });
      if (readmeRes.ok) {
        readme = await readmeRes.text();
      } else {
        const fallbackRes = await fetch(`${rawBase}/readme.md`, {
          headers: { Accept: 'text/plain, text/markdown' },
        });
        if (fallbackRes.ok) readme = await fallbackRes.text();
      }
    } catch {
      /* network or fetch failure */
    }

    // 2. Fetch llms.txt & llms-full.txt
    let llmsTxt: string | null = null;
    let llmsFullTxt: string | null = null;
    try {
      const [llmsRes, llmsFullRes] = await Promise.allSettled([
        fetch(`${rawBase}/llms.txt`, { headers: { Accept: 'text/plain' } }),
        fetch(`${rawBase}/llms-full.txt`, { headers: { Accept: 'text/plain' } }),
      ]);
      if (llmsRes.status === 'fulfilled' && llmsRes.value.ok) {
        const text = await llmsRes.value.text();
        if (text.trim().length > 10) llmsTxt = text;
      }
      if (llmsFullRes.status === 'fulfilled' && llmsFullRes.value.ok) {
        const text = await llmsFullRes.value.text();
        if (text.trim().length > 10) llmsFullTxt = text;
      }
    } catch {
      /* non-blocking */
    }

    // 3. Fetch public repo metadata via GitHub REST API (best-effort)
    let metadata: GitHubRepoMetadata | undefined;
    try {
      const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Luminara-Search-Oracle-Agent',
        },
      });
      if (apiRes.ok) {
        const data = (await apiRes.json()) as any;
        metadata = {
          name: data.name || repo,
          fullName: data.full_name || `${owner}/${repo}`,
          description: data.description || '',
          stars: data.stargazers_count || 0,
          forks: data.forks_count || 0,
          openIssues: data.open_issues_count || 0,
          homepage: data.homepage || undefined,
          license: data.license?.spdx_id || data.license?.name || undefined,
          topics: Array.isArray(data.topics) ? data.topics : [],
          defaultBranch: data.default_branch || 'main',
        };
      }
    } catch {
      /* API rate limited or offline; fallback without metadata */
    }

    return { readme, llmsTxt, llmsFullTxt, metadata };
  }

  /**
   * Evaluates a repository against Generative Engine Optimization (GEO) and AEO citability rules.
   */
  public evaluate(
    ref: GitHubRepoRef,
    readme: string,
    llmsTxt: string | null,
    llmsFullTxt: string | null,
    metadata?: GitHubRepoMetadata
  ): GitHubCitabilityEvaluation {
    const recommendations: string[] = [];
    let score = 30; // base score for a public repo

    const hasLlmsTxt = Boolean(llmsTxt && llmsTxt.trim().length > 20);
    const hasLlmsFullTxt = Boolean(llmsFullTxt && llmsFullTxt.trim().length > 20);

    if (hasLlmsTxt) {
      score += 25;
    } else {
      recommendations.push('Add an `llms.txt` file in repo root to guide AI search bots (Perplexity, Claude, ChatGPT Search).');
    }

    if (hasLlmsFullTxt) {
      score += 5;
    }

    // Analyze README structure
    const words = (readme.match(/[A-Za-z0-9À-ÿ'’-]+/g) || []);
    const readmeWordCount = words.length;

    // Extract first meaningful answer paragraph (skipping badges, banners, and h1 titles)
    const paragraphs = readme
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => {
        if (!p) return false;
        if (p.startsWith('#')) return false;
        if (p.startsWith('[![')) return false; // badge line
        if (p.startsWith('<p align="center">')) return false; // center banner
        if (p.startsWith('<img')) return false;
        return true;
      });

    const firstAnswerBlock = paragraphs[0] || '';
    const answerWords = (firstAnswerBlock.match(/[A-Za-z0-9À-ÿ'’-]+/g) || []);
    const firstAnswerWordCount = answerWords.length;

    // AEO 40-70 word target
    const hasAeoAnswerTarget = firstAnswerWordCount >= 35 && firstAnswerWordCount <= 85;
    if (hasAeoAnswerTarget) {
      score += 20;
    } else if (firstAnswerWordCount > 0) {
      if (firstAnswerWordCount < 35) {
        recommendations.push(`Expand the opening README summary (${firstAnswerWordCount} words) into a 40–60 word declarative solution block for Answer Engine extraction.`);
        score += 8;
      } else {
        recommendations.push(`Opening section is slightly verbose (${firstAnswerWordCount} words). Lead with a punchy 40–60 word declarative answer before detailed paragraphs.`);
        score += 10;
      }
    } else {
      recommendations.push('Add a concise 40–60 word opening summary explaining what the project solves and who it is for.');
    }

    // Code blocks & syntax tags
    const hasCodeBlocks = /```[\s\S]*?```/.test(readme);
    const hasFencedSyntaxTags = /```(bash|sh|shell|typescript|javascript|python|go|rust|json|html|css)\b/.test(readme);

    if (hasCodeBlocks) {
      score += 5;
      if (hasFencedSyntaxTags) {
        score += 5;
      } else {
        recommendations.push('Tag code blocks with explicit language identifiers (e.g., ```bash or ```typescript) to improve LLM parsing accuracy.');
      }
    } else {
      recommendations.push('Include explicit installation and quickstart code blocks with syntax highlighting tags.');
    }

    // License & Governance
    const hasLicense = Boolean(metadata?.license || /license/i.test(readme));
    if (hasLicense) {
      score += 5;
    } else {
      recommendations.push('Specify an open source license (MIT, Apache-2.0, etc.) so LLMs recognize commercial and usage terms.');
    }

    // Homepage / Docs
    const hasHomepageDocs = Boolean(metadata?.homepage || /https?:\/\/[^\s)]+(docs|guide|wiki)/i.test(readme));
    if (hasHomepageDocs) {
      score += 5;
    } else {
      recommendations.push('Link to a canonical documentation URL in repository metadata and header.');
    }

    // Normalized Citability Score bounded 0-100
    const citabilityScore = Math.min(100, Math.max(0, score));

    // Generate suggested llms.txt
    const repoTitle = metadata?.name || ref.repo;
    const desc = metadata?.description || firstAnswerBlock || 'High-performance open-source project.';
    const docsUrl = metadata?.homepage || `https://github.com/${ref.owner}/${ref.repo}#readme`;

    const suggestedLlmsTxt = `# ${repoTitle}

> ${desc}

## Core Documentation
- [README](${docsUrl}): Overview, quickstart, and installation guide.
- [GitHub Repository](https://github.com/${ref.owner}/${ref.repo}): Source code, issues, and discussions.

## Key Concepts
- High-level architecture and developer workflows.
- Integration patterns and API references.
`;

    return {
      repo: ref,
      metadata,
      hasLlmsTxt,
      hasLlmsFullTxt,
      llmsTxtSnippet: llmsTxt ? llmsTxt.slice(0, 1000) : undefined,
      readmeWordCount,
      firstAnswerBlock: firstAnswerBlock.slice(0, 600),
      firstAnswerWordCount,
      hasAeoAnswerTarget,
      hasCodeBlocks,
      hasFencedSyntaxTags,
      hasLicense,
      hasHomepageDocs,
      citabilityScore,
      recommendations,
      suggestedLlmsTxt,
    };
  }

  /**
   * Integrates into UnifiedScraper to return a ScrapedPageEvidence payload for GitHub repositories.
   */
  public async scrapeAndDistillGitHub(
    url: string,
    ref: GitHubRepoRef,
    options: { maxChars?: number } = {}
  ): Promise<ScrapedPageEvidence> {
    const startTime = performance.now();
    const { readme, llmsTxt, llmsFullTxt, metadata } = await this.fetchRepoContent(ref);

    const evaluation = this.evaluate(ref, readme, llmsTxt, llmsFullTxt, metadata);

    // Combine into structured text for distillation
    const combinedMarkdown = `
# GitHub Repository: ${ref.owner}/${ref.repo}
${metadata?.description ? `> ${metadata.description}\n` : ''}

- **Stars:** ${metadata?.stars ?? 'unknown'} | **Forks:** ${metadata?.forks ?? 'unknown'} | **License:** ${metadata?.license ?? (evaluation.hasLicense ? 'Detected' : 'Missing')}
- **Homepage:** ${metadata?.homepage || 'None'}
- **Topics:** ${metadata?.topics.join(', ') || 'None'}
- **llms.txt:** ${evaluation.hasLlmsTxt ? 'PRESENT' : 'MISSING'}
- **llms-full.txt:** ${evaluation.hasLlmsFullTxt ? 'PRESENT' : 'MISSING'}
- **Citability Score:** ${evaluation.citabilityScore}/100
- **AEO Answer Target (40-60 words):** ${evaluation.hasAeoAnswerTarget ? 'PASS' : 'OPTIMIZATION NEEDED'} (${evaluation.firstAnswerWordCount} words)

## Recommendations for Generative Engine Optimization (GEO)
${evaluation.recommendations.map((r) => `- ${r}`).join('\n')}

${llmsTxt ? `## Current llms.txt\n\`\`\`text\n${llmsTxt.slice(0, 1200)}\n\`\`\`\n` : ''}

## Repository README
${readme || '_No README.md found in repository root._'}
`;

    const distilled: DistilledContentResult = contentDistiller.distill(
      '',
      combinedMarkdown,
      { maxChars: options.maxChars || 12000 }
    );

    const formattedEvidence = `
---
[EVIDENCE SOURCE: GitHub Direct Content & GEO Citability Engine]
Repository: https://github.com/${ref.owner}/${ref.repo}
GEO Citability Score: ${evaluation.citabilityScore}/100
llms.txt: ${evaluation.hasLlmsTxt ? 'DETECTED' : 'MISSING (Action Required)'}
AEO Answer Target: ${evaluation.hasAeoAnswerTarget ? 'OPTIMIZED' : `NEEDS REVISION (${evaluation.firstAnswerWordCount} words)`}
License: ${metadata?.license || (evaluation.hasLicense ? 'Present' : 'Missing')}

Key Citability Recommendations:
${evaluation.recommendations.map((r) => `* ${r}`).join('\n')}

---
${distilled.distilledText}
`;

    return {
      success: true,
      providerUsed: 'direct',
      url,
      statusCode: 200,
      title: `${ref.owner}/${ref.repo} - GitHub Repository Audit`,
      description: metadata?.description || `GitHub repository audit for ${ref.owner}/${ref.repo}`,
      markdown: combinedMarkdown,
      distilled,
      formattedEvidence,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

export const githubCitabilityService = GitHubCitabilityService.getInstance();
