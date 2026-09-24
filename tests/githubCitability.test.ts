import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubCitabilityService } from '../services/scraping/githubCitabilityService';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';

describe('GitHubCitabilityService', () => {
  describe('parseGitHubUrl', () => {
    it('parses standard https GitHub URLs', () => {
      const parsed = githubCitabilityService.parseGitHubUrl('https://github.com/facebook/react');
      expect(parsed).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('parses naked domain GitHub URLs', () => {
      const parsed = githubCitabilityService.parseGitHubUrl('github.com/vercel/next.js');
      expect(parsed).toEqual({ owner: 'vercel', repo: 'next.js' });
    });

    it('handles .git suffixes and sub-paths like /tree/main', () => {
      const parsed = githubCitabilityService.parseGitHubUrl('https://github.com/shadcn-ui/ui.git');
      expect(parsed).toEqual({ owner: 'shadcn-ui', repo: 'ui' });

      const parsedSub = githubCitabilityService.parseGitHubUrl('https://github.com/owner/my-repo/tree/main/src');
      expect(parsedSub).toEqual({ owner: 'owner', repo: 'my-repo' });
    });

    it('rejects reserved GitHub system pages and non-github domains', () => {
      expect(githubCitabilityService.parseGitHubUrl('https://github.com/pricing')).toBeNull();
      expect(githubCitabilityService.parseGitHubUrl('https://github.com/features')).toBeNull();
      expect(githubCitabilityService.parseGitHubUrl('https://stripe.com')).toBeNull();
      expect(githubCitabilityService.parseGitHubUrl('')).toBeNull();
    });
  });

  describe('evaluate citability rules', () => {
    const ref = { owner: 'acme', repo: 'super-lib' };

    it('scores high when llms.txt is present and README has a 40-70 word declarative answer target', () => {
      const readme = `
# SuperLib

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()

SuperLib is a high-performance, edge-first telemetry SDK built specifically for modern TypeScript and Node.js microservices. It delivers millisecond trace correlation, zero-overhead payload scrubbing, and automatic span aggregation without requiring external collector agents or proprietary vendor daemons in production.

## Installation
\`\`\`bash
npm install super-lib
\`\`\`

## License
MIT
`;
      const llmsTxt = `# SuperLib\n> Telemetry SDK\n- [Docs](https://superlib.dev)`;

      const evalResult = githubCitabilityService.evaluate(ref, readme, llmsTxt, null, {
        name: 'super-lib',
        fullName: 'acme/super-lib',
        description: 'Edge telemetry SDK',
        stars: 1200,
        forks: 80,
        openIssues: 5,
        homepage: 'https://superlib.dev',
        license: 'MIT',
        topics: ['telemetry', 'typescript'],
        defaultBranch: 'main',
      });

      expect(evalResult.hasLlmsTxt).toBe(true);
      expect(evalResult.hasAeoAnswerTarget).toBe(true);
      expect(evalResult.hasCodeBlocks).toBe(true);
      expect(evalResult.hasFencedSyntaxTags).toBe(true);
      expect(evalResult.citabilityScore).toBeGreaterThanOrEqual(80);
      expect(evalResult.suggestedLlmsTxt).toContain('super-lib');
    });

    it('identifies missing llms.txt and suboptimal README answer length', () => {
      const readme = `
# TinyRepo

A cool tool.
`;
      const evalResult = githubCitabilityService.evaluate(ref, readme, null, null);

      expect(evalResult.hasLlmsTxt).toBe(false);
      expect(evalResult.hasAeoAnswerTarget).toBe(false);
      expect(evalResult.recommendations.some((r) => r.includes('llms.txt'))).toBe(true);
      expect(evalResult.recommendations.some((r) => r.includes('opening summary') || r.includes('Expand the opening'))).toBe(true);
      expect(evalResult.citabilityScore).toBeLessThan(70);
    });
  });

  describe('UnifiedScraperService GitHub Interception', () => {
    it('routes GitHub URLs through githubCitabilityService and returns direct evidence', async () => {
      const spy = vi.spyOn(githubCitabilityService, 'scrapeAndDistillGitHub').mockResolvedValueOnce({
        success: true,
        providerUsed: 'direct',
        url: 'https://github.com/mock-owner/mock-repo',
        title: 'mock-owner/mock-repo - GitHub Repository Audit',
        description: 'Mock repo',
        markdown: '# Mock Repo',
        distilled: {
          title: 'mock-owner/mock-repo',
          description: 'Mock repo',
          distilledText: 'Mock repo text',
          headings: [],
          schemas: [],
          stats: { rawChars: 100, distilledChars: 50, reductionPercent: 50, retainedParagraphs: 1 },
        },
        formattedEvidence: '[EVIDENCE SOURCE: GitHub Direct Content & GEO Citability Engine]',
        latencyMs: 15,
      });

      const res = await unifiedScraperService.scrapeAndDistill('https://github.com/mock-owner/mock-repo');

      expect(spy).toHaveBeenCalled();
      expect(res.success).toBe(true);
      expect(res.title).toContain('mock-owner/mock-repo');
      expect(res.formattedEvidence).toContain('GitHub Direct Content');

      spy.mockRestore();
    });
  });
});
