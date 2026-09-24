import { describe, expect, it } from 'vitest';
import {
  asymmetricOverlap,
  buildGroundingReport,
  buildPointerMessages,
  composePointerInstruction,
  cropAroundPoint,
  evaluateModelGate,
  luminaraSurfaceSeed,
  mapPointFromCrop,
  parseGeometry,
  plannerEmittedCoordinates,
  pointInBBox,
  POINTER_SYSTEM_PROMPT,
  predictionsFromJsonl,
  runAgenticPointer,
  scoreExample,
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from '../services/grounding';

describe('grounding protocol', () => {
  it('ships the fixed-frame PointerBench system prompt', () => {
    expect(POINTER_SYSTEM_PROMPT).toContain('1024x768');
    expect(POINTER_SYSTEM_PROMPT).toContain('absolute pixel');
    expect(POINTER_SYSTEM_PROMPT).toContain('Do not return normalized coordinates');
  });

  it('rejects normalized-looking points when asked', () => {
    const parsed = parseGeometry('{"point": [0.5, 0.5]}', 'point', {
      rejectNormalized: true,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
    });
    expect(parsed).toBeNull();
  });

  it('parses absolute points and bboxes from noisy model text', () => {
    const point = parseGeometry('Sure.\n```json\n{"point":[441,312]}\n```', 'point');
    expect(point).toEqual({ kind: 'point', point: [441, 312], raw: expect.any(Object) });
    const box = parseGeometry('{"bbox":[40,599,671,611]}', 'bbox');
    expect(box?.bbox).toEqual([40, 599, 671, 611]);
  });
});

describe('geometry scoring', () => {
  it('scores point-in-bbox', () => {
    expect(pointInBBox([100, 100], [90, 90, 110, 110])).toBe(true);
    expect(pointInBBox([50, 50], [90, 90, 110, 110])).toBe(false);
  });

  it('uses asymmetric overlap (coverage high, precision reasonable)', () => {
    const gt: [number, number, number, number] = [100, 100, 200, 120];
    const good: [number, number, number, number] = [95, 98, 205, 122];
    const cutOff: [number, number, number, number] = [100, 100, 140, 120];
    expect(asymmetricOverlap(good, gt).ok).toBe(true);
    expect(asymmetricOverlap(cutOff, gt).ok).toBe(false);
  });
});

describe('planner / pointer split', () => {
  it('composes language-only pointer instructions', () => {
    const instruction = composePointerInstruction({
      action: 'click',
      target: 'the Run audit button',
      constraints: 'primary CTA, not the secondary link',
    });
    expect(instruction).toBe(
      'Click the Run audit button. Constraint: primary CTA, not the secondary link',
    );
    expect(plannerEmittedCoordinates(instruction)).toBe(false);
    expect(plannerEmittedCoordinates('{"point":[1,2]}')).toBe(true);
  });

  it('builds pointer messages with fixed frame', () => {
    const { system, user, request } = buildPointerMessages(
      { action: 'click', target: 'Copy share link', surface: 'share_link' },
      { luminaraSurface: true },
    );
    expect(system).toContain('1024x768');
    expect(system).toContain('Luminara Suite');
    expect(user).toContain('Copy share link');
    expect(request.imageWidth).toBe(1024);
    expect(request.imageHeight).toBe(768);
  });
});

describe('agentic zoom', () => {
  it('maps crop-frame points back to the full frame', () => {
    const crop = cropAroundPoint([512, 384], 1024, 768, 0.5);
    const mapped = mapPointFromCrop([512, 384], crop, 1024, 768);
    expect(mapped[0]).toBeCloseTo((crop[0] + crop[2]) / 2, 5);
    expect(mapped[1]).toBeCloseTo((crop[1] + crop[3]) / 2, 5);
  });

  it('runs a two-step zoom loop and returns absolute geometry', async () => {
    const { final, steps } = await runAgenticPointer({
      system: POINTER_SYSTEM_PROMPT,
      request: {
        instruction: 'Click cell E15',
        answerType: 'point',
        imageWidth: 1024,
        imageHeight: 768,
        agentic: true,
      },
      call: async ({ step }) => {
        if (step === 0) return '{"point":[400,300]}';
        return '{"point":[512,384]}';
      },
    });
    expect(steps).toHaveLength(2);
    expect(final.kind).toBe('point');
    expect(final.point).toBeDefined();
  });
});

describe('model gate + luminara seed', () => {
  it('rejects vanity-only candidates and sheet heroes with dead Text', () => {
    const vanity = evaluateModelGate({
      scores: { sheets: 0.9, text: 0.5, pro: 0.8 },
      vanityBenchOnly: true,
    });
    expect(vanity.pass).toBe(false);
    expect(vanity.vanityOnlyRejected).toBe(true);

    const textFail = evaluateModelGate({
      scores: { sheets: 0.95, text: 0.2, pro: 0.9 },
    });
    expect(textFail.pass).toBe(false);
    expect(textFail.reasons.some((r) => r.includes('Text') || r.includes('text'))).toBe(true);
  });

  it('passes a balanced PointerBench-style scorecard', () => {
    const gate = evaluateModelGate({
      scores: { sheets: 0.82, text: 0.48, pro: 0.77 },
    });
    expect(gate.pass).toBe(true);
  });

  it('scores the Luminara surface seed with perfect predictions', () => {
    const examples = luminaraSurfaceSeed();
    const preds = predictionsFromJsonl(
      examples.map((ex) => {
        if (ex.answer_type === 'bbox') {
          return { id: ex.id, bbox: [...ex.bbox] as [number, number, number, number] };
        }
        const [x0, y0, x1, y1] = ex.bbox;
        return { id: ex.id, point: [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number] };
      }),
    );
    const report = buildGroundingReport(examples, preds, {
      required: ['luminara'],
    });
    expect(report.subsets[0]?.accuracy).toBe(1);
    expect(report.gate.pass).toBe(true);
  });

  it('marks a miss when the click is outside the target', () => {
    const ex = luminaraSurfaceSeed()[0];
    const detail = scoreExample(ex, { id: ex.id, point: [1, 1] });
    expect(detail.ok).toBe(false);
  });
});
