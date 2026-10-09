import { describe, it, expect } from 'vitest';
import { speakableText } from '../services/voice/speechText';

describe('speakableText', () => {
  it('converts markdown code fences into spoken references', () => {
    const markdown =
      'Here is the schema to deploy:\n```jsonld\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage"\n}\n```\nMake sure to test it.';
    const spoken = speakableText(markdown);
    expect(spoken).toContain('(a JSON-LD schema code block)');
    expect(spoken).not.toContain('@context');
    expect(spoken).toContain('Make sure to test it.');
  });

  it('converts markdown tables into natural comma-separated lists', () => {
    const table = `
# Visibility Results
| Engine | Score | Status |
|---|---|---|
| Google AIO | 78% | Cited |
| Perplexity | 64% | Missing |
`;
    const spoken = speakableText(table);
    expect(spoken).toContain('Visibility Results.');
    expect(spoken).toContain('Google AIO, 78%, Cited');
    expect(spoken).toContain('Perplexity, 64%, Missing');
    expect(spoken).not.toContain('|---|---|');
  });

  it('sanitizes links, images, headings, and long file paths', () => {
    const input = `
### Weekly Decision
Check our report at [Luminara Dashboard](https://luminarasuite.com/report) and inspect \`src/components/views/InstantAuditView.tsx\` for details.
See chart: ![Radar Chart](https://example.com/chart.png).
`;
    const spoken = speakableText(input);
    expect(spoken).toContain('Weekly Decision.');
    expect(spoken).toContain('Check our report at Luminara Dashboard and inspect InstantAuditView.tsx for details.');
    expect(spoken).toContain('(image: Radar Chart)');
    expect(spoken).not.toContain('src/components/views/');
  });

  it('handles empty input gracefully', () => {
    expect(speakableText('')).toBe('');
  });
});
