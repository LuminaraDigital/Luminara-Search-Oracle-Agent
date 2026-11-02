import { PRODUCTION_MINI_APP_URL } from '../referrals/rules';

/** Production Play listing. Package com.luminarasuite.app. */
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.luminarasuite.app';

/** Production bot. Mini App path is PRODUCTION_MINI_APP_URL. */
export const TELEGRAM_BOT_URL = 'https://t.me/LuminaraSuiteBot';

export const TELEGRAM_MINI_APP_PUBLIC_URL = PRODUCTION_MINI_APP_URL;

type SurfaceCopy = {
  label: string;
  title: string;
  body: string;
};

export type WebSurface = SurfaceCopy & { id: 'web' };

export type TelegramSurface = SurfaceCopy & {
  id: 'telegram';
  miniAppUrl: string;
  botUrl: string;
};

export type AndroidSurface = SurfaceCopy & {
  id: 'android';
  storeUrl: string;
};

export type PlatformSurface = WebSurface | TelegramSurface | AndroidSurface;

/** Home, footer, FAQ, and crawl copy share these three surfaces. No counts. */
export const PLATFORM_SURFACES: readonly PlatformSurface[] = [
  {
    id: 'web',
    label: 'Web',
    title: 'The full Suite, and where you upgrade',
    body: 'Run the free check here, then Instant Audit, Scout, and Ask once you sign in. When you want a paid pass by card, you buy it on this site.',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    title: 'Community, Mini App, and Stars',
    body: 'Telegram is the Suite\'s community and in-chat home. The Mini App runs Instant Audit, Scout, and Ask. Open @LuminaraSuiteBot to start. Subscribe with Stars for a paid pass. Link Telegram to your web account and that plan is shared.',
    miniAppUrl: TELEGRAM_MINI_APP_PUBLIC_URL,
    botUrl: TELEGRAM_BOT_URL,
  },
  {
    id: 'android',
    label: 'Android',
    title: 'Instant Audit on the go',
    body: 'Take Instant Audit with you. The app on Google Play is a free companion. Sign in with the same account as the website and your plan syncs. Bring your own provider keys if you want. The app does not sell passes. Upgrades by card stay on the website.',
    storeUrl: PLAY_STORE_URL,
  },
];

export const PLATFORM_FAQ_ANSWER =
  'On the website, in Telegram, and on Android. This site is where you run the Suite and upgrade by card. The Mini App at ' +
  `${TELEGRAM_MINI_APP_PUBLIC_URL} puts Instant Audit in Telegram, and @LuminaraSuiteBot is the chat you open to start. Stars checkout is in Telegram. ` +
  `The Android app on Google Play (${PLAY_STORE_URL}) is a free companion for Instant Audit away from the desk. Sign in with your web account to sync the plan, or bring your own keys. Card checkout stays on the website.`;
