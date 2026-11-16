/**
 * The checks every Oracle chat reply goes through, as one pure step. The caller decides when the
 * user sees the result: today's streaming path has already sent its tokens and appends warnings;
 * the tool loop (worker/oracleAgent) sends nothing until this has run.
 */
import { monitorOracleOutput } from './oracleInteractionGuard';
import { guardPasteReadyCopy } from '../services/audit/healthClaimGuard';
import { runAllValidators, summarizeFindings } from './agentOutputValidators';
import { withoutUnmeasuredClaims } from './chatHonesty';

export type ReplyCheck = {
  /** The reply after the paste-ready guard and the unmeasured-claim filter. */
  text: string;
  /** The paste-ready guard removed a health claim. */
  healthChanged: boolean;
  /** Sentences that stated a measurement nobody made. */
  unmeasuredReplaced: number;
  monitor: ReturnType<typeof monitorOracleOutput>;
  validation: ReturnType<typeof runAllValidators>;
  validationSummary: ReturnType<typeof summarizeFindings>;
};

/**
 * userTexts: what the user supplied (messages, account memory, their stored project), the current
 * message last. evidenceTexts: the text of every measured tool result in this turn.
 */
export function checkOracleReply(reply: string, opts: { userTexts: string[]; evidenceTexts: string[] }): ReplyCheck {
  const monitor = monitorOracleOutput(reply, opts.evidenceTexts.length > 0);
  const guarded = guardPasteReadyCopy(reply);
  const afterGuard = guarded.changed ? guarded.text : reply;
  const validation = runAllValidators(afterGuard);
  const honest = withoutUnmeasuredClaims(afterGuard, opts.userTexts, opts.evidenceTexts);
  return {
    text: honest.replaced > 0 ? honest.text : afterGuard,
    healthChanged: guarded.changed,
    unmeasuredReplaced: honest.replaced,
    monitor,
    validation,
    validationSummary: summarizeFindings(validation.findings),
  };
}
