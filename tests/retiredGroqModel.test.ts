import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RETIRED = 'llama-3.3-70b-versatile';

describe('retired Groq model', () => {
  it('is not requested by any Worker file', () => {
    const offenders = readdirSync('worker', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => readFileSync(join('worker', file), 'utf8').includes(RETIRED));

    expect(offenders).toEqual([]);
  });

  it('is not the Android default', () => {
    const models = readFileSync('apps/android/app/src/main/kotlin/com/luminarasuite/app/core/model/LuminaraModels.kt', 'utf8');

    expect(models).not.toContain(RETIRED);
  });
});
