import { describe, expect, it } from 'vitest';
import {
  validateMcpHarness,
  validateGroundingHarness,
  validateWorkerHarness,
  validateTelegramHarness,
  evaluateMultiHarness,
  type HarnessAction,
} from '../services/harness/multiHarnessSuite';

describe('Multi-Harness Agent Alignment Suite (Pillar 3)', () => {
  describe('validateMcpHarness', () => {
    it('validates conforming MCP tool calls', () => {
      const action: HarnessAction = {
        surface: 'mcp',
        type: 'tool_call',
        name: 'get_project_context',
        params: { domain: 'luminarasuite.com' },
      };

      const result = validateMcpHarness(action);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.errors.length).toBe(0);
    });

    it('rejects hallucinated or unapproved MCP tools', () => {
      const action: HarnessAction = {
        surface: 'mcp',
        type: 'tool_call',
        name: 'execute_arbitrary_shell',
        params: { command: 'rm -rf /' },
      };

      const result = validateMcpHarness(action);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('hallucinated'))).toBe(true);
    });
  });

  describe('validateGroundingHarness (PointerBench Protocol)', () => {
    it('validates proper 1024x768 absolute pixel coordinates', () => {
      const action: HarnessAction = {
        surface: 'grounding',
        type: 'gui_click',
        targetCoords: [512, 384],
      };

      const result = validateGroundingHarness(action);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('catches model regression into normalized [0, 1] coordinates', () => {
      const action: HarnessAction = {
        surface: 'grounding',
        type: 'gui_click',
        targetCoords: [0.5, 0.38],
      };

      const result = validateGroundingHarness(action);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('normalized'))).toBe(true);
    });

    it('rejects out of bounds coordinates', () => {
      const action: HarnessAction = {
        surface: 'grounding',
        type: 'gui_click',
        targetCoords: [1100, 850],
      };

      const result = validateGroundingHarness(action);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateWorkerHarness', () => {
    it('validates compliant SSE streaming chunks', () => {
      const action: HarnessAction = {
        surface: 'worker',
        type: 'sse_event',
        content: 'data: {"status": "observing", "taskId": "tsk_123"}\n\n',
      };

      const result = validateWorkerHarness(action);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('rejects unparseable or corrupted worker payloads', () => {
      const action: HarnessAction = {
        surface: 'worker',
        type: 'sse_event',
        content: 'data: {invalid_json_stream_chunk',
      };

      const result = validateWorkerHarness(action);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('not valid JSON'))).toBe(true);
    });
  });

  describe('validateTelegramHarness', () => {
    it('validates mobile telegram messages within limits', () => {
      const action: HarnessAction = {
        surface: 'telegram',
        type: 'telegram_reply',
        content: '🔎 *Audit Result*\nHealth score: 85\nVerdict: High visibility in AI search.',
      };

      const result = validateTelegramHarness(action);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('rejects oversized telegram responses exceeding 4096 chars', () => {
      const action: HarnessAction = {
        surface: 'telegram',
        type: 'telegram_reply',
        content: 'a'.repeat(4500),
      };

      const result = validateTelegramHarness(action);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('4096'))).toBe(true);
    });
  });

  describe('evaluateMultiHarness', () => {
    it('evaluates multi-surface bundle and generates composite scorecard', () => {
      const actions: HarnessAction[] = [
        {
          surface: 'mcp',
          type: 'tool_call',
          name: 'get_project_context',
          params: { domain: 'luminarasuite.com' },
        },
        {
          surface: 'grounding',
          type: 'gui_click',
          targetCoords: [600, 400],
        },
        {
          surface: 'worker',
          type: 'sse_event',
          content: 'data: {"ok": true}',
        },
        {
          surface: 'telegram',
          type: 'telegram_reply',
          content: 'Audit complete.',
        },
      ];

      const scorecard = evaluateMultiHarness(actions);
      expect(scorecard.passedAll).toBe(true);
      expect(scorecard.overallScore).toBe(1.0);
      expect(scorecard.summary).toContain('All 4 harnesses passed');
    });
  });
});
