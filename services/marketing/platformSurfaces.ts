import externalLinks from '../../electron/externalLinks.json' with { type: 'json' };

export interface DesktopExternalLink {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly tray: boolean;
}

/** Single canonical list shared with electron/main.cjs (packaged in ASAR). */
export const DESKTOP_EXTERNAL_LINKS: readonly DesktopExternalLink[] = externalLinks.desktopLinks;

function requireDesktopLinkHref(id: string): string {
  const match = DESKTOP_EXTERNAL_LINKS.find((link) => link.id === id);
  if (!match) throw new Error(`Missing canonical desktop link: ${id}`);
  return match.href;
}

/** Canonical public website, help, and store links shared across web and desktop shell. */
export const WEBSITE_URL = requireDesktopLinkHref('website');
export const FAQ_URL = requireDesktopLinkHref('faq');
export const CONTACT_URL = externalLinks.contact;
export const DESKTOP_DOWNLOAD_URL = requireDesktopLinkHref('windows');

/** Production Play listing. Package com.luminarasuite.app. */
export const PLAY_STORE_URL = requireDesktopLinkHref('google-play');

/** Production bot and Mini App URLs. */
export const TELEGRAM_BOT_URL = requireDesktopLinkHref('telegram-bot');
export const TELEGRAM_MINI_APP_PUBLIC_URL = requireDesktopLinkHref('telegram-mini-app');

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
