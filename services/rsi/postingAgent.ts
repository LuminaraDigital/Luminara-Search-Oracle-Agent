/**
 * Deterministic post drafts, a winner picked from measured history, and a
 * weekly playbook reflection. A pattern is added only after two measured
 * successes, and a week can add at most two patterns.
 */

export const POST_PATTERN_KEYS = ['question', 'proof', 'audience', 'offer', 'contrast'] as const;
export type PostPatternKey = (typeof POST_PATTERN_KEYS)[number];

export interface PostCandidate {
  id: string;
  patternKey: PostPatternKey;
  hook: string;
  body: string;
}

export interface MeasuredPost {
  patternKey: PostPatternKey;
  engagements72: number | null;
}

export function generatePostCandidates(input: {
  brandName: string;
  offer: string;
  audience: string;
  count?: number;
}): PostCandidate[] {
  const brand = input.brandName.trim() || 'the brand';
  const offer = input.offer.trim() || 'the offer';
  const audience = input.audience.trim() || 'the reader';
  const wanted = Math.min(5, Math.max(3, input.count ?? 4));
  const drafts: PostCandidate[] = [
    {
      id: 'question',
      patternKey: 'question',
      hook: `What should ${audience} check first?`,
      body: `${brand} looks at one citation gap at a time. If a rate was not measured, the post says not_measured.`,
    },
    {
      id: 'proof',
      patternKey: 'proof',
      hook: `${brand} only cites a number that was measured.`,
      body: `No guessed citation rate. ${offer} starts from the last measured audit, or from not_measured when that audit has no rate.`,
    },
    {
      id: 'audience',
      patternKey: 'audience',
      hook: `${audience} can see the next fix without a dashboard novel.`,
      body: `${brand}: one verdict, one move, and a link to the report.`,
    },
    {
      id: 'offer',
      patternKey: 'offer',
      hook: `${offer} is the move this week.`,
      body: `${brand} publishes the winner only after comparing a few drafts against measured post history.`,
    },
    {
      id: 'contrast',
      patternKey: 'contrast',
      hook: `A guessed metric is not a result.`,
      body: `${brand} will say not_measured before it will invent a citation rate for ${audience}.`,
    },
  ];
  return drafts.slice(0, wanted);
}

export function predictWinner(
  candidates: readonly PostCandidate[],
  history: readonly MeasuredPost[],
): { winnerId: string; prediction: 'measured' | 'not_measured'; evidence: string } {
  if (candidates.length < 3 || candidates.length > 5) {
    return { winnerId: candidates[0]?.id || '', prediction: 'not_measured', evidence: 'Need 3 to 5 candidates.' };
  }
  const measured = history.filter((post) => post.engagements72 != null && Number.isFinite(post.engagements72));
  if (measured.length < 3) {
    return { winnerId: candidates[0].id, prediction: 'not_measured', evidence: 'not_measured' };
  }
  const sorted = [...measured].sort((a, b) => (a.engagements72 as number) - (b.engagements72 as number));
  const median = sorted[Math.floor(sorted.length / 2)].engagements72 as number;
  const wins = new Map<PostPatternKey, number>();
  for (const post of measured) {
    if ((post.engagements72 as number) > median) {
      wins.set(post.patternKey, (wins.get(post.patternKey) || 0) + 1);
    }
  }
  const ranked = [...candidates].sort((a, b) => (wins.get(b.patternKey) || 0) - (wins.get(a.patternKey) || 0));
  const top = ranked[0];
  const topWins = wins.get(top.patternKey) || 0;
  if (topWins === 0) {
    return { winnerId: candidates[0].id, prediction: 'not_measured', evidence: 'not_measured' };
  }
  return {
    winnerId: top.id,
    prediction: 'measured',
    evidence: `${top.patternKey} beat the measured median on ${topWins} posts.`,
  };
}

export interface PlaybookReflection {
  body: string;
  added: string[];
  skipped: string[];
  reason: string;
}

export function reflectPostingPlaybook(input: {
  brandName: string;
  history: readonly MeasuredPost[];
  currentBody: string | null;
  pinned: boolean;
  editsThisWeek: number;
  maxEdits?: number;
  evidenceRef: string;
}): PlaybookReflection {
  const maxEdits = input.maxEdits ?? 2;
  if (input.pinned) {
    return { body: input.currentBody || '', added: [], skipped: [], reason: 'Pinned playbooks stay fixed until a person unpins them.' };
  }
  const room = Math.max(0, maxEdits - input.editsThisWeek);
  if (room === 0) {
    return { body: input.currentBody || '', added: [], skipped: [], reason: 'Change cap reached (2 playbook edits per week).' };
  }
  const measured = input.history.filter((post) => post.engagements72 != null && Number.isFinite(post.engagements72));
  if (measured.length < 3) {
    return { body: input.currentBody || '', added: [], skipped: [], reason: 'Not enough measured 72h posts to name a success. Evidence: not_measured.' };
  }
  const sorted = [...measured].sort((a, b) => (a.engagements72 as number) - (b.engagements72 as number));
  const median = sorted[Math.floor(sorted.length / 2)].engagements72 as number;
  const wins = new Map<PostPatternKey, number>();
  for (const post of measured) {
    if ((post.engagements72 as number) > median) wins.set(post.patternKey, (wins.get(post.patternKey) || 0) + 1);
  }
  const existing = input.currentBody || '';
  const added: string[] = [];
  const skipped: string[] = [];
  for (const key of POST_PATTERN_KEYS) {
    const count = wins.get(key) || 0;
    if (count < 2) continue;
    const line = `- Pattern ${key}: beat the measured median on ${count} posts.`;
    if (existing.includes(`Pattern ${key}:`) || added.some((item) => item.includes(`Pattern ${key}:`))) {
      skipped.push(key);
      continue;
    }
    if (added.length >= room) {
      skipped.push(key);
      continue;
    }
    added.push(line);
  }
  if (added.length === 0) {
    return { body: existing, added: [], skipped, reason: skipped.length > 0 ? 'Patterns already recorded or over the weekly cap.' : 'No pattern has 2 measured successes yet.' };
  }
  const pinnedBlock = existing.match(/## Pinned[\s\S]*?(?=\n## |\s*$)/)?.[0]?.trim() || '## Pinned\nNone yet.';
  const body = [
    `# Posting playbook: ${input.brandName}`,
    '',
    '## When to use',
    'Prefer a pattern only after it has beaten the measured 72h median at least twice.',
    '',
    '## Patterns',
    ...(existing.match(/^- Pattern .+$/gm) || []),
    ...added,
    '',
    pinnedBlock,
    '',
    '## Evidence',
    'Success means a measured 72h engagement above the brand median. Unmeasured posts are not successes.',
    `- ${input.evidenceRef}`,
    '',
  ].join('\n');
  return { body, added, skipped, reason: `Added ${added.length} pattern(s).` };
}
