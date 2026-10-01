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

/**
 * Telegram back, hash change, popstate, and the marketing redirect are not a fresh handoff.
 * Instant Audit on those paths remounts with no idea id. Any other view leaves Idea Scout.
 */
export function continuumEventForViewChange(nextView: string): ContinuumEvent {
  if (nextView === 'INSTANT_AUDIT') return { type: 'open_instant_audit' };
  return { type: 'leave_idea_scout' };
}

/** The audit that is about to link consumes the id. The following audit does not see it. */
export function takeContinuumLink(current: string | undefined): {
  linkId: string | undefined;
  next: string | undefined;
} {
  if (!current) return { linkId: undefined, next: undefined };
  return { linkId: current, next: undefined };
}
