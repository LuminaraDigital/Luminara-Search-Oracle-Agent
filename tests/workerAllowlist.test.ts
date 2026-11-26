import { describe, expect, it } from 'vitest';
import { isPathAllowed } from '../worker/index';

describe('provider path allowlist', () => {
  const spec = { allow: ['/chat/completions', '/models'] };

  it('allows exact and nested paths', () => {
    expect(isPathAllowed(spec, '/chat/completions')).toBe(true);
    expect(isPathAllowed(spec, '/models/openai/gpt-oss-120b')).toBe(true);
    expect(isPathAllowed({ allow: ['/v1beta/models'] }, '/v1beta/models/gemini-3-flash-preview:streamGenerateContent')).toBe(true);
  });

  it('blocks everything else, including prefix look-alikes', () => {
    expect(isPathAllowed(spec, '/audio/transcriptions')).toBe(false);
    expect(isPathAllowed(spec, '/chat/completionsX')).toBe(false);
    expect(isPathAllowed(spec, '/modelsteal')).toBe(false);
    expect(isPathAllowed(undefined, '/models')).toBe(false);
  });

  it('rejects path traversal, encoded separators, trailing slashes, and single-endpoint suffixes (M-22)', () => {
    expect(isPathAllowed(spec, '/chat/completions/')).toBe(false);
    expect(isPathAllowed(spec, '/chat/completions/extra')).toBe(false);
    expect(isPathAllowed(spec, '/chat/completions:extra')).toBe(false);
    expect(isPathAllowed(spec, '/models/')).toBe(false);
    expect(isPathAllowed(spec, '/models/../audio/transcriptions')).toBe(false);
    expect(isPathAllowed(spec, '/models/%2e%2e/audio/transcriptions')).toBe(false);
    expect(isPathAllowed(spec, '/models/%2E%2E/audio/transcriptions')).toBe(false);
    expect(isPathAllowed(spec, '/models/%252e%252e/audio/transcriptions')).toBe(false);
    expect(isPathAllowed(spec, '/models/foo%2fbar')).toBe(false);
    expect(isPathAllowed(spec, '/models/foo%5cbar')).toBe(false);
    expect(isPathAllowed(spec, '/models/foo\\bar')).toBe(false);
    expect(isPathAllowed(spec, '/models/%E0%A4%A')).toBe(false);
    expect(isPathAllowed({ allow: ['/crawl'] }, '/crawl/job_123')).toBe(true);
    expect(isPathAllowed({ allow: ['/crawl'] }, '/crawl/')).toBe(false);
    expect(isPathAllowed({ allow: ['/crawl'] }, '/crawl/..%2fadmin')).toBe(false);
  });
});
