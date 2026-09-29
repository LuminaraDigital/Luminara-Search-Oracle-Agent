/**
 * One Idea Scout handoff may link one Instant Audit.
 * A later audit, or any navigation that is not that handoff, drops the id.
 */

export type ContinuumEvent =
  | { type: 'handoff'; ideaId?: string }
  | { type: 'open_instant_audit' }
  | { type: 'leave_idea_scout' }
  | { type: 'link_succeeded' }
  | { type: 'link_failed' };

export function resolveContinuumIdeaId(
  current: string | undefined,
  event: ContinuumEvent,
): string | undefined {
  if (event.type === 'handoff') return event.ideaId || undefined;
  if (event.type === 'link_failed') return current;
  return undefined;
}

/** The audit that is about to link consumes the id. The following audit does not see it. */
export function takeContinuumLink(current: string | undefined): {
  linkId: string | undefined;
  next: string | undefined;
} {
  if (!current) return { linkId: undefined, next: undefined };
  return { linkId: current, next: undefined };
}
