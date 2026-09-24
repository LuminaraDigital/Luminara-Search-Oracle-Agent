/**
 * Independent DONE verifiers. Model DONE is never proof of success.
 */
import type { ObservePayload, VerifyCheckDetail, VerifyChecks, VerifyResult } from './types';

function asList(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function includesCheck(
  name: string,
  haystack: string | null | undefined,
  needles: string[],
): VerifyCheckDetail[] {
  return needles.map((expected) => {
    if (haystack == null || haystack === '') {
      return { check: name, result: 'not_measured', expected, actual: haystack ?? undefined };
    }
    const ok = haystack.toLowerCase().includes(expected.toLowerCase());
    return {
      check: name,
      result: ok ? 'pass' : 'fail',
      expected,
      actual: haystack.slice(0, 200),
    };
  });
}

/**
 * Verify a claimed DONE against independent page checks.
 * - No checks provided: fail closed as not_verified.
 * - Missing observe fields for a requested check: not_measured.
 * - Any fail: not_verified.
 * - All pass: verified.
 */
export function verifyDone(args: {
  goal: string;
  observe: ObservePayload | null | undefined;
  checks?: VerifyChecks;
}): VerifyResult {
  void args.goal;
  const checks = args.checks;
  const details: VerifyCheckDetail[] = [];

  if (!checks) {
    return {
      ok: false,
      status: 'not_verified',
      details: [{ check: 'verifier', result: 'fail', expected: 'checks required' }],
    };
  }

  const urlNeedles = asList(checks.urlIncludes);
  const textNeedles = asList(checks.textIncludes);
  const titleNeedles = asList(checks.titleIncludes);

  if (urlNeedles.length + textNeedles.length + titleNeedles.length === 0) {
    return {
      ok: false,
      status: 'not_verified',
      details: [{ check: 'verifier', result: 'fail', expected: 'at least one check' }],
    };
  }

  const observe = args.observe;
  if (!observe) {
    return {
      ok: false,
      status: 'not_measured',
      details: [{ check: 'observe', result: 'not_measured', expected: 'ObservePayload' }],
    };
  }

  details.push(...includesCheck('urlIncludes', observe.url, urlNeedles));
  details.push(...includesCheck('textIncludes', observe.text, textNeedles));
  details.push(...includesCheck('titleIncludes', observe.title, titleNeedles));

  const anyFail = details.some((d) => d.result === 'fail');
  const anyMissing = details.some((d) => d.result === 'not_measured');
  const allPass = details.length > 0 && details.every((d) => d.result === 'pass');

  if (allPass) {
    return { ok: true, status: 'verified', details };
  }
  if (anyFail) {
    return { ok: false, status: 'not_verified', details };
  }
  if (anyMissing) {
    return { ok: false, status: 'not_measured', details };
  }
  return { ok: false, status: 'not_verified', details };
}
