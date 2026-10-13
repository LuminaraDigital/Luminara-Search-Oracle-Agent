/**
 * Citation outcomes for a recommended fix.
 * A gain is a success only when both rates were measured and the later rate is higher.
 * Missing rates stay not_measured. This module does not invent a number.
 */

export type CitationMeasurement = 'measured' | 'not_measured';
export type FixEffect = 'success' | 'no_gain' | 'regression' | 'not_measured';

export interface CitedFixInput {
  measurementStatus: CitationMeasurement;
  beforeCitationRate: number | null;
  afterCitationRate: number | null;
}

export function classifyFixEffect(input: CitedFixInput): { ok: true; effect: FixEffect } | { ok: false; reason: string } {
  const { measurementStatus, beforeCitationRate, afterCitationRate } = input;
  if (measurementStatus !== 'measured' && measurementStatus !== 'not_measured') {
    return { ok: false, reason: 'measurementStatus must be measured or not_measured.' };
  }
  const rates = [beforeCitationRate, afterCitationRate];
  if (measurementStatus === 'not_measured') {
    if (rates.some((rate) => rate != null)) {
      return { ok: false, reason: 'Do not send a citation rate when the status is not_measured.' };
    }
    return { ok: true, effect: 'not_measured' };
  }
  if (beforeCitationRate == null || afterCitationRate == null) {
    return { ok: false, reason: 'A measured fix needs both the before and after citation rates.' };
  }
  if (!Number.isFinite(beforeCitationRate) || !Number.isFinite(afterCitationRate)) {
    return { ok: false, reason: 'Citation rates must be finite numbers.' };
  }
  if (afterCitationRate > beforeCitationRate) return { ok: true, effect: 'success' };
  if (afterCitationRate < beforeCitationRate) return { ok: true, effect: 'regression' };
  return { ok: true, effect: 'no_gain' };
}

export function actionMemoryFromFix(input: {
  domain: string;
  title: string;
  signature: string;
  effect: FixEffect;
  beforeCitationRate: number | null;
  afterCitationRate: number | null;
  sourceRefs: string[];
}): { title: string; content: string; structuredData: Record<string, unknown>; confidence: number } {
  const title = `Fix: ${input.title}`.slice(0, 180);
  const rateLine =
    input.effect === 'not_measured' || input.beforeCitationRate == null || input.afterCitationRate == null
      ? 'AI citation rate: not_measured. This run is not a success.'
      : `AI citation rate before: ${input.beforeCitationRate}. After: ${input.afterCitationRate}. Effect: ${input.effect}.`;
  return {
    title,
    content: `Fix "${input.title}" (${input.signature}) on ${input.domain}.\n${rateLine}`,
    structuredData: {
      signature: input.signature,
      effect: input.effect,
      measurementStatus: input.effect === 'not_measured' ? 'not_measured' : 'measured',
      beforeCitationRate: input.effect === 'not_measured' ? null : input.beforeCitationRate,
      afterCitationRate: input.effect === 'not_measured' ? null : input.afterCitationRate,
    },
    confidence: input.effect === 'success' ? 0.9 : input.effect === 'not_measured' ? 0.6 : 0.75,
  };
}

export interface FixStat {
  signature: string;
  successes: number;
  regressions: number;
  measured: number;
}

export function rankFixes<T extends { signature: string }>(
  items: readonly T[],
  stats: readonly FixStat[],
  normalize: (signature: string) => string,
): Array<T & { rankScore: number; evidence: string }> {
  const bySig = new Map(stats.map((stat) => [stat.signature, stat]));
  const decorated = items.map((item, index) => {
    const stat = bySig.get(normalize(item.signature));
    if (!stat || stat.measured === 0) {
      return { item, index, rankScore: 0, evidence: 'not_measured' };
    }
    const rankScore = Number(((stat.successes - stat.regressions) / stat.measured).toFixed(4));
    const evidence = `${stat.successes} measured gains, ${stat.regressions} regressions, ${stat.measured} measured runs`;
    return { item, index, rankScore, evidence };
  });
  decorated.sort((a, b) => b.rankScore - a.rankScore || a.index - b.index);
  return decorated.map(({ item, rankScore, evidence }) => ({ ...item, rankScore, evidence }));
}
