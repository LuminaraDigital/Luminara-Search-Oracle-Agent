import { createSessionCookie } from '../apiClient';
import { getFirebaseIdToken } from './firebaseAuthService';

const AUTHORIZE_PREFIX = '/api/oauth/mcp/authorize?';

/** The approval URL to return to after sign-in. Anything else is an open redirect, so it is dropped. */
export function agentConnectTarget(search: string): string | null {
  const target = new URLSearchParams(search).get('agent_connect');
  return target?.startsWith(AUTHORIZE_PREFIX) ? target : null;
}

/** The approval screen is a plain navigation, so it needs the cookie rather than the app's bearer token. */
export async function resumeAgentConnect(target: string): Promise<void> {
  const idToken = await getFirebaseIdToken().catch(() => null);
  const hasCookie = idToken ? await createSessionCookie(idToken) : false;
  // Without a cookie the approval route would send the owner straight back here, forever.
  window.location.replace(hasCookie ? target : '/');
}
