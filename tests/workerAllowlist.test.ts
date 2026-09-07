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
});
