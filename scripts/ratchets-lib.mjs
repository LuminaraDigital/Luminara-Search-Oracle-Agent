// Ratchets: per-file debt counts that a change may lower but not raise.
// The base branch is the baseline, so there is no baseline file to merge or prune.
// Idea from stablyai/orca (MIT) ratchet baselines; no code copied. Node stdlib only, ESM.

const VENDORED = /^(\.claude|\.cursor|open-seo|ponytail|pstack|scratch|node_modules|dist|build|coverage)\//;
const SOURCE = /\.(ts|tsx)$/;
const TEST = /(^|\/)(tests|e2e)\/|\.test\.tsx?$/;
const GENERATED = /\.generated\.|\.d\.ts$/;

export const MAX_FILE_LINES = 1000;

function isSource(file) {
  return SOURCE.test(file) && !VENDORED.test(file) && !GENERATED.test(file);
}

/** Tests fake and deliberately mistype things, so the type ratchets leave them alone. */
function isProductSource(file) {
  return isSource(file) && !TEST.test(file);
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

/** Each ratchet scores one file's text. A change fails when a file's score is above its score on the base. */
export const RATCHETS = [
  {
    name: 'explicit-any',
    unit: 'explicit any type(s)',
    include: isProductSource,
    measure: (text) => countMatches(text, /\bas any\b|:\s*any\b|<any>/g),
    fix: 'Type the value, or narrow from unknown at the trust boundary.',
  },
  {
    name: 'check-suppressions',
    unit: 'lint or type suppression(s)',
    include: isProductSource,
    measure: (text) => countMatches(text, /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/g),
    fix: 'Fix what the checker reports instead of silencing it.',
  },
  {
    name: 'oversized-file',
    unit: `file over ${MAX_FILE_LINES} lines`,
    include: isSource,
    measure: (text) => (text.split('\n').length > MAX_FILE_LINES ? 1 : 0),
    fix: `Split the file before it passes ${MAX_FILE_LINES} lines.`,
  },
];

/**
 * `changes`: files that differ from the base, each with its text now and on the base
 * (`before` is null for a new file). Returns one regression per ratchet a file made worse.
 */
export function findRegressions(changes, ratchets = RATCHETS) {
  const regressions = [];
  for (const { file, before, after } of changes) {
    for (const ratchet of ratchets) {
      if (!ratchet.include(file)) continue;
      const allowed = before === null ? 0 : ratchet.measure(before);
      const now = ratchet.measure(after);
      if (now > allowed) regressions.push({ file, ratchet, now, allowed });
    }
  }
  return regressions;
}

/** Parses `git diff --name-status -z -M`: returns { file, baseFile } for added, modified and renamed files. */
export function parseNameStatus(raw) {
  const fields = raw.split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i][0];
    if (status === 'R') {
      changed.push({ file: fields[i + 2], baseFile: fields[i + 1] });
      i += 3;
      continue;
    }
    if (status === 'A') changed.push({ file: fields[i + 1], baseFile: null });
    if (status === 'M') changed.push({ file: fields[i + 1], baseFile: fields[i + 1] });
    i += 2;
  }
  return changed;
}
