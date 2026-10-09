import { describe, expect, it } from 'vitest';
import {
  evaluateCrawlReadiness,
  classifyEvidenceStatus,
  generateFastDecisionVerdict,
} from '../services/decision/fastDecisionService';

describe('Fast Decision Models (Pillar 1)', () => {
  describe('evaluateCrawlReadiness', () => {
    it('evaluates fully open domain with valid llms.txt as ready', () => {
      const robots = `
        User-agent: *
        Allow: /
      `;
      const llms = `
        # Luminara Suite
        > AI visibility audit platform
        - [Docs](https://luminarasuite.com/docs)
      `;

      const result = evaluateCrawlReadiness('example.com', {
        robotsTxtContent: robots,
        llmsTxtContent: llms,
        https: true,
      });

      expect(result.ready).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.llmsTxt.status).toBe('present');
      expect(result.robotsTxt.status).toBe('allowed');
      expect(result.robotsTxt.aiBotsAllowed.gptBot).toBe(true);
      expect(result.robotsTxt.aiBotsAllowed.claudeBot).toBe(true);
      expect(result.latencyMs).toBeLessThan(100);
    });

    it('identifies blanket AI crawler restrictions in robots.txt', () => {
      const robots = `
        User-agent: *
        Disallow: /
      `;

      const result = evaluateCrawlReadiness('blocked.com', {
        robotsTxtContent: robots,
        https: true,
      });

      expect(result.ready).toBe(false);
      expect(result.robotsTxt.status).toBe('disallowed');
      expect(result.robotsTxt.aiBotsAllowed.gptBot).toBe(false);
      expect(result.robotsTxt.aiBotsAllowed.claudeBot).toBe(false);
    });

    it('handles missing robots.txt and invalid llms.txt gracefully', () => {
      const result = evaluateCrawlReadiness('minimal.com', {
        robotsTxtContent: null,
        llmsTxtContent: 'short',
        https: false,
      });

      expect(result.llmsTxt.status).toBe('invalid');
      expect(result.robotsTxt.status).toBe('missing');
    });
  });

  describe('classifyEvidenceStatus (RLCD & Brier loss calibration)', () => {
    it('classifies cryptographically anchored HTTP 200 payload as measured', () => {
      const result = classifyEvidenceStatus({
        scrapedUrl: 'https://example.com',
        httpStatus: 200,
        contentLength: 4200,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        hasVerifiedSelectors: true,
      });

      expect(result.status).toBe('measured');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.probabilities.measured).toBeGreaterThan(result.probabilities.estimated);
      expect(result.probabilities.measured).toBeGreaterThan(result.probabilities.not_measured);
      expect(result.brierLoss).toBeLessThan(0.3);
      expect(result.latencyMs).toBeLessThan(50);
    });

    it('classifies heuristic/search estimates as estimated', () => {
      const result = classifyEvidenceStatus({
        scrapedUrl: 'https://example.com',
        isModelEstimate: true,
        sourcesCount: 5,
      });

      expect(result.status).toBe('estimated');
      expect(result.probabilities.estimated).toBeGreaterThan(result.probabilities.measured);
    });

    it('classifies missing or failed scrapes as not_measured without inventing metrics', () => {
      const result = classifyEvidenceStatus({
        scrapedUrl: 'https://example.com',
        httpStatus: 0,
        contentLength: 0,
      });

      expect(result.status).toBe('not_measured');
      expect(result.probabilities.not_measured).toBeGreaterThan(result.probabilities.measured);
      expect(result.rationale).toContain('not_measured');
    });
  });

  describe('generateFastDecisionVerdict', () => {
    it('produces terse verdict and prioritized single weekly action', () => {
      const readiness = evaluateCrawlReadiness('acme.com', {
        robotsTxtContent: 'User-agent: *\nAllow: /',
        llmsTxtContent: '# Acme Docs\n- [API](https://acme.com/api)',
        https: true,
      });

      const evidence = classifyEvidenceStatus({
        scrapedUrl: 'https://acme.com',
        httpStatus: 200,
        contentLength: 2500,
        sha256: 'a'.repeat(64),
      });

      const decision = generateFastDecisionVerdict('acme.com', 'AEO', readiness, evidence);

      expect(decision.verdict).toBeTruthy();
      expect(decision.oneMoveThisWeek).toBeTruthy();
      expect(decision.healthScore).toBeGreaterThanOrEqual(0);
      expect(decision.healthScore).toBeLessThanOrEqual(100);
      expect(decision.latencyMs).toBeLessThan(50);
    });
  });
});
