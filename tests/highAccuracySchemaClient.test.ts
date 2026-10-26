import { describe, expect, it } from 'vitest';
import { SCHEMA_HA_ESTIMATE_LABEL } from '../services/highAccuracy/contract';
import {
  buildSchemaRequest,
  expectedTypeFromSchema,
  failureNote,
  formatAccuracyReceipt,
  readHighAccuracyResponse,
  resolveByokSchemaTarget,
} from '../services/highAccuracy/schemaClient';
import type { ByokKeyBag } from '../services/highAccuracy/schemaClient';
import type { ChatModelPreference } from '../services/llm/chatModelCatalog';

const emptyKeys = (): ByokKeyBag => ({
  groq: '',
  nim: '',
  nimOrg: '',
  ollama: '',
  ollamaModel: 'llama3.2',
  openrouter: '',
});

const auto: ChatModelPreference = { mode: 'auto', provider: 'groq', model: 'openai/gpt-oss-120b' };

describe('resolveByokSchemaTarget', () => {
  it('ignores a hosted proxy sentinel and uses the first real key', () => {
    const keys = emptyKeys();
    keys.groq = 'proxy';
    keys.openrouter = 'sk-or-user';
    const target = resolveByokSchemaTarget(auto, keys);
    expect(target).toMatchObject({ providerId: 'openrouter', key: 'sk-or-user', label: 'OpenRouter' });
  });

  it('pins a manual provider and appends a NIM org id', () => {
    const keys = emptyKeys();
    keys.groq = 'gsk_user';
    keys.nim = 'nvapi-user';
    keys.nimOrg = 'org_9';
    const pref: ChatModelPreference = { mode: 'manual', provider: 'nim', model: 'google/gemma-3-12b-it' };
    expect(resolveByokSchemaTarget(pref, keys)).toMatchObject({
      providerId: 'nim',
      model: 'google/gemma-3-12b-it',
      key: 'nvapi-user|org_9',
    });
  });

  it('returns null when every key is missing', () => {
    expect(resolveByokSchemaTarget(auto, emptyKeys())).toBeNull();
  });
});

describe('schema request and receipt', () => {
  it('puts the provider key in the header and not in the JSON body', () => {
    const parts = buildSchemaRequest({
      target: { providerId: 'groq', model: 'openai/gpt-oss-120b', key: 'gsk_user_owned', label: 'Groq' },
      pageUrl: 'https://acme.example/about',
      evidence: 'Acme builds fountains.',
      expectedType: 'Organization',
    });
    expect(parts.path).toBe('/api/high-accuracy/schema');
    expect(parts.headers['x-provider-key']).toBe('gsk_user_owned');
    expect(JSON.stringify(parts.body)).not.toContain('gsk_user_owned');
    expect(parts.body.evidence).toBe('Acme builds fountains.');
  });

  it('formats a receipt and reads a passing response', () => {
    const accuracy = {
      mode: 'best_of_n' as const,
      winnerIndex: 1,
      attempts: [
        { index: 0, ok: false, reasons: ['MISSING_Organization_name'] },
        { index: 1, ok: true, reasons: [] },
      ],
      estimate: SCHEMA_HA_ESTIMATE_LABEL,
      usage: { calls: 2, failed: 0, usageMissing: 0, promptTokens: 2950, completionTokens: 1862, totalTokens: 4812 },
      keySource: 'byok' as const,
    };
    expect(formatAccuracyReceipt(accuracy)).toBe(
      '2 calls · 4,812 tokens (2,950 in / 1,862 out) · candidate 2 passed schema checks',
    );
    const read = readHighAccuracyResponse(200, { ok: true, schemaJsonLd: '{"@type":"Organization"}', accuracy });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.schemaJsonLd).toContain('Organization');
  });

  it('keeps a failure note when no candidate passes', () => {
    const read = readHighAccuracyResponse(200, {
      ok: false,
      code: 'no_candidate',
      schemaJsonLd: null,
      accuracy: {
        mode: 'best_of_n',
        winnerIndex: null,
        attempts: [{ index: 0, ok: false, reasons: ['OFF_SITE_URL'] }],
        estimate: SCHEMA_HA_ESTIMATE_LABEL,
        usage: { calls: 1, failed: 0, usageMissing: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        keySource: 'byok',
      },
    });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(failureNote(read)).toBe("High-accuracy run didn't improve this result. (OFF_SITE_URL)");
    expect(expectedTypeFromSchema('{"@type":"Restaurant","name":"Acme"}')).toBe('Restaurant');
  });
});
