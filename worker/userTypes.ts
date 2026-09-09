/** Shared identity shape for hosted-key quota and user persistence. */
export type HostedIdentity = {
  /** Login key: Telegram uses String(id); Firebase uses `fb:{uid}`. */
  id: string;
  source: 'telegram' | 'firebase';
  email?: string;
  name?: string;
  /**
   * Shared billing + workspace id after upsert/link.
   * Stars, TON, and (later) Stripe all write `sub:{accountId}`.
   */
  accountId?: string;
};
