import { describe, expect, it } from 'vitest';
import {
  BrowserActionLoop,
  buildActionSpace,
  fieldContext,
  fieldContextCacheKey,
  parseFieldTextResponse,
  StalePageError,
  validateChoice,
  ValueError,
  verifyDone,
  type ObservePayload,
  type ObservedAction,
} from '../services/browserAction';

function sampleActions(): ObservedAction[] {
  return [
    {
      id: 'e1',
      kind: 'click',
      label: 'Pricing',
      role: 'link',
      node: 'n1',
    },
    {
      id: 'e2',
      kind: 'fill',
      label: 'Search',
      role: 'textbox',
      value: '',
      node: 'n2',
    },
    {
      id: 'e3',
      kind: 'select',
      label: 'Plan → Pro',
      role: 'option',
      value: 'pro',
      current_value: '',
      node: 'n3',
    },
    {
      id: 'e4',
      kind: 'select',
      label: 'Plan → Agency',
      role: 'option',
      value: 'agency',
      current_value: '',
      node: 'n3',
    },
    {
      id: 'scroll_down',
      kind: 'scroll',
      label: 'Scroll down',
      node: 'scroll',
    },
    {
      id: 'wait',
      kind: 'wait',
      label: 'Wait briefly',
      node: 'wait',
    },
  ];
}

function samplePage(overrides: Partial<ObservePayload> = {}): ObservePayload {
  return {
    url: 'https://example.com/pricing',
    title: 'Pricing',
    text: 'Choose Pro or Agency. FAQ accordion closed.',
    actions: sampleActions(),
    fingerprint: 'fp-1',
    ...overrides,
  };
}

describe('actionSpace indexing', () => {
  it('indexes click/fill/select into elements and targets; scroll/wait into controls; always DONE/BLOCKED', () => {
    const { elements, targets, controls } = buildActionSpace(sampleActions());

    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ index: '1', label: 'Pricing', operations: ['CLICK'] });
    expect(elements[1]).toMatchObject({ index: '2', label: 'Search', operations: ['TYPE_TEXT'] });
    expect(elements[2].index).toBe('3');
    expect(elements[2].operations).toContain('SELECT');
    expect(elements[2].options).toHaveLength(2);
    expect(elements[2].options?.[0].index).toBe('3:1');
    expect(elements[2].options?.[1].index).toBe('3:2');

    expect(targets.CLICK['1'].id).toBe('e1');
    expect(targets.TYPE_TEXT['2'].id).toBe('e2');
    expect(targets.SELECT['3:1'].id).toBe('e3');
    expect(targets.SELECT['3:2'].id).toBe('e4');

    expect(controls.SCROLL_DOWN.id).toBe('scroll_down');
    expect(controls.WAIT.id).toBe('wait');
    expect(controls.DONE.id).toBe('DONE');
    expect(controls.BLOCKED.id).toBe('BLOCKED');
  });
});

describe('validateChoice', () => {
  it('accepts a peaked valid distribution', () => {
    const answer = validateChoice(
      {
        choice: 'CLICK',
        probabilities: { CLICK: 0.7, DONE: 0.2, BLOCKED: 0.1 },
        confidence: 0.8,
      },
      ['CLICK', 'DONE', 'BLOCKED'],
    );
    expect(answer.choice).toBe('CLICK');
  });

  it('rejects invalid choice answers without acting', () => {
    expect(() =>
      validateChoice(
        {
          choice: 'HACK',
          probabilities: { CLICK: 1 },
          confidence: 1,
        },
        ['CLICK', 'DONE'],
      ),
    ).toThrow(ValueError);

    expect(() =>
      validateChoice(
        {
          choice: 'CLICK',
          probabilities: { CLICK: 0.4, DONE: 0.6 },
          confidence: 0.9,
        },
        ['CLICK', 'DONE'],
      ),
    ).toThrow(/Invalid choice/);

    expect(() =>
      validateChoice(
        {
          choice: 'CLICK',
          probabilities: { CLICK: 0.5 },
          confidence: 1,
        },
        ['CLICK', 'DONE'],
      ),
    ).toThrow(ValueError);
  });
});

describe('field text JSON gate', () => {
  it('requires exactly {"text": string} non-empty <=2000', () => {
    expect(parseFieldTextResponse('{"text":"hello"}')).toBe('hello');
    expect(parseFieldTextResponse({ text: 'ok' })).toBe('ok');

    expect(() => parseFieldTextResponse('{"text":""}')).toThrow(ValueError);
    expect(() => parseFieldTextResponse('{"text":"  "}')).toThrow(ValueError);
    expect(() => parseFieldTextResponse('{"text":"x","extra":1}')).toThrow(ValueError);
    expect(() => parseFieldTextResponse({ text: 'a'.repeat(2001) })).toThrow(ValueError);
    expect(() => parseFieldTextResponse('not json')).toThrow(ValueError);
  });
});

describe('verifyDone', () => {
  it('fails closed when DONE has no verifier checks', () => {
    const result = verifyDone({
      goal: 'Open pricing',
      observe: samplePage(),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_verified');
  });

  it('passes when independent checks match', () => {
    const result = verifyDone({
      goal: 'See Agency plan',
      observe: samplePage({ text: 'Agency plan includes MCP' }),
      checks: { textIncludes: 'Agency plan', urlIncludes: '/pricing' },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('verified');
  });

  it('returns not_measured when observe fields are missing', () => {
    const result = verifyDone({
      goal: 'See title',
      observe: samplePage({ title: '' }),
      checks: { titleIncludes: 'Pricing' },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_measured');
  });
});

describe('pending text cache key', () => {
  it('caches TYPE_TEXT only when the entire helper input is identical', async () => {
    const page = samplePage({ fingerprint: 'fp-cache' });
    const fill = page.actions.find((a) => a.id === 'e2')!;
    const ctxA = fieldContext('search luminara', fill, page, []);
    const ctxB = fieldContext('search luminara', fill, page, []);
    const ctxC = fieldContext('search other', fill, page, []);

    expect(fieldContextCacheKey(ctxA)).toBe(fieldContextCacheKey(ctxB));
    expect(fieldContextCacheKey(ctxA)).not.toBe(fieldContextCacheKey(ctxC));

    let fieldCalls = 0;
    let actCalls = 0;
    const loop = new BrowserActionLoop({
      goal: 'search luminara',
      initialPage: page,
      observe: async () => ({ ...page, fingerprint: `fp-re-${actCalls}` }),
      executeAct: async () => {
        actCalls += 1;
        if (actCalls === 1) throw new StalePageError();
        return { ...page, fingerprint: 'fp-ok' };
      },
      chooseFn: async () => ({
        choice: 'e2',
        operation: 'TYPE_TEXT',
        target: '2',
        confidence: 1,
        probabilities: { e2: 1 },
        operation_probabilities: { TYPE_TEXT: 1 },
      }),
      fieldLlm: async () => {
        fieldCalls += 1;
        return '{"text":"luminara"}';
      },
    });

    // First tick: generate text, mutation stale -> pending kept (identical helper input).
    await loop.tick();
    expect(fieldCalls).toBe(1);
    expect(loop.getPendingTextCacheKey()).toBe(fieldContextCacheKey(ctxA));

    // Restore identical page context (history still empty because mutation never landed).
    loop.state.page = { ...page, fingerprint: 'fp-retry' };
    loop.state.status = 'ready';
    await loop.predict();
    await loop.act();
    expect(fieldCalls).toBe(1);
    expect(loop.getPendingTextCacheKey()).toBeNull();
  });
});
