/** Shared identity shape for hosted-key quota and user persistence. */
export type HostedIdentity = {
  /** KV/D1 key fragment: Telegram uses String(id); Firebase uses `fb:{uid}`. */
  id: string;
  source: 'telegram' | 'firebase';
  email?: string;
  name?: string;
};
