import { describe, it, expect } from 'vitest';
import { compressToolResult, stripAnsi, elideLines } from '../services/compression/toolResultCompressor';
import { CavemanEngine } from '../services/compression/caveman';
import { canonicalizeSystemPrefix, partitionPromptForCaching } from '../services/compression/prefixFreeze';

describe('Compression Engine - RTK Tool Output Compressor', () => {
  it('strips ANSI terminal escape sequences cleanly', () => {
    const raw = '\x1b[32mSuccess:\x1b[0m Crawled \x1b[1mpage\x1b[0m';
    expect(stripAnsi(raw)).toBe('Success: Crawled page');
  });

  it('elides middle lines for oversized text while preserving head and tail', () => {
    const longText = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    const { text, elidedCount } = elideLines(longText, 20, 10);
    expect(elidedCount).toBe(70);
    expect(text).toContain('Line 1');
    expect(text).toContain('Line 20');
    expect(text).toContain('… [70 lines elided for brevity] …');
    expect(text).toContain('Line 100');
  });

  it('compresses tool result with metrics', () => {
    const rawOutput = 'Some log line\n' + 'repeated line\n'.repeat(80);
    const result = compressToolResult(rawOutput, { keepHead: 10, keepTail: 5 });
    expect(result.savedChars).toBeGreaterThan(0);
    expect(result.reductionPercentage).toBeGreaterThan(0);
    expect(result.compressed).toContain('elided for brevity');
  });
});

describe('Compression Engine - Caveman Natural Language Pruning', () => {
  it('strips pleasantries, polite framing, and filler adverbs', () => {
    const input = 'Hello! Could you please basically review this audit report? Due to the fact that competitors rank higher.';
    const { compressed, reductionPercentage } = CavemanEngine.compress(input);
    expect(compressed).toContain('review this audit report?');
    expect(compressed).toContain('because competitors rank higher.');
    expect(compressed).not.toContain('Hello!');
    expect(compressed).not.toContain('Could you please');
    expect(compressed).not.toContain('basically');
    expect(reductionPercentage).toBeGreaterThan(15);
  });

  it('strictly preserves markdown code blocks, inline code, and URLs', () => {
    const input = `Please make sure to check this url: https://luminarasuite.com/pricing\n\nAnd examine the code:\n\`\`\`typescript\nconst x = "basically hello";\n\`\`\`\nAlso check \`const y = please\`.`;
    const { compressed } = CavemanEngine.compress(input);

    expect(compressed).toContain('https://luminarasuite.com/pricing');
    expect(compressed).toContain('const x = "basically hello";');
    expect(compressed).toContain('`const y = please`');
  });
});

describe('Compression Engine - Prefix Freeze & Cache Preservation', () => {
  it('canonicalizes system playbooks and strips transient timestamps', () => {
    const playbook = 'System Instructions:\nCurrent time: 2026-09-10 12:00:00\nExecute SEO audit.';
    const canonical = canonicalizeSystemPrefix(playbook);
    expect(canonical).not.toContain('Current time:');
    expect(canonical).toContain('System Instructions:');
    expect(canonical).toContain('Execute SEO audit.');
  });

  it('partitions prompt for stable KV caching with anchor keys', () => {
    const envelope = partitionPromptForCaching('System Playbook v1', 'Audit Context for domain.com', 'How to rank?');
    expect(envelope.frozenPrefix).toBe('System Playbook v1');
    expect(envelope.dynamicSuffix).toContain('Audit Context for domain.com');
    expect(envelope.dynamicSuffix).toContain('How to rank?');
    expect(envelope.cacheAnchorKey).toMatch(/^anchor_[a-f0-9]+$/);
  });
});
