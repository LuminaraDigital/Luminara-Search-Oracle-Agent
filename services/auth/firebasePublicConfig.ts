/**
 * Public Firebase web app config (safe to ship in the browser bundle).
 * Env VITE_FIREBASE_* overrides these when set; values here keep production
 * Cloudflare builds working when .env is not present on the build machine.
 */
export const FIREBASE_PUBLIC_CONFIG = {
  apiKey: 'AIzaSyDPX87WXZHFQu7XuCJyHhDoVcyY1-z8bxc',
  authDomain: 'luminara-suite.firebaseapp.com',
  projectId: 'luminara-suite',
  appId: '1:274315225068:web:092053650dfce884f482c9',
  messagingSenderId: '274315225068',
  storageBucket: 'luminara-suite.firebasestorage.app',
} as const;
