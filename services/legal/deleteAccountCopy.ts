import { OPERATOR_LINE } from './consumerTerms';

export const SUPPORT_EMAIL = 'support@luminarasuite.com';

export const DELETE_ACCOUNT_INTRO =
  'You can delete a Luminara Suite account from the Android app, from the website when you are signed in, or by email. This page does not list prices and does not take payment.';

export interface DeleteAccountStep {
  title: string;
  paragraphs: string[];
}

export const DELETE_ACCOUNT_STEPS: DeleteAccountStep[] = [
  {
    title: 'Delete from the Android app',
    paragraphs: [
      'Open Settings. In Privacy, Data Export and Account Deletion, sign in if you are not already.',
      'Type DELETE in the field labelled "Type DELETE to permanently erase account", then tap Permanently Delete Account & Data.',
      'That sends a delete request for the signed-in account. If you are not signed in, there is no cloud account to delete. To remove data stored only on the device, clear the app storage in Android settings or uninstall the app.',
    ],
  },
  {
    title: 'Delete on the website',
    paragraphs: [
      'Sign in at luminarasuite.com. Open Settings, then Account.',
      'Type DELETE. If the account uses a password, enter the current password. Then choose Delete account.',
      'That removes the live rows for the account, including workspaces, audits, public win pages, and saved fix state, and it deletes a Firebase sign-in when there is one.',
    ],
  },
  {
    title: 'Email support',
    paragraphs: [
      `If you cannot use the app or the website, email ${SUPPORT_EMAIL} from the address on the account and ask for deletion. Include that email, or the account id if you have it.`,
    ],
  },
];

export const DELETE_ACCOUNT_RETENTION =
  'Cloudflare D1 Time Travel can restore a database backup for 30 days. We do not restore a deleted account from that backup unless the law requires it. Records a payment partner must keep stay.';

export const DELETE_ACCOUNT_OPERATOR = `${OPERATOR_LINE}. Founded 2025.`;
