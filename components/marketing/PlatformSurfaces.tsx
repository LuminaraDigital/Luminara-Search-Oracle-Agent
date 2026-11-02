import React from 'react';
import {
  PLATFORM_SURFACES,
  PLAY_STORE_URL,
  TELEGRAM_MINI_APP_PUBLIC_URL,
  type PlatformSurface,
} from '../../services/marketing/platformSurfaces';
import './space.css';

const CHIP =
  'inline-flex min-h-11 items-center rounded-full border border-[var(--color-rule)] bg-black/40 px-3.5 text-sm text-[var(--color-ink)] transition-colors hover:border-[rgb(252_246_186/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-light)]';

function Outbound({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function PlatformCta({ surface, onCheckSite }: { surface: PlatformSurface; onCheckSite: () => void }) {
  switch (surface.id) {
    case 'web':
      return (
        <button type="button" onClick={onCheckSite} className="lx-btn lx-btn-gold">
          Start on the web
        </button>
      );
    case 'telegram':
      return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Outbound href={surface.miniAppUrl} className="lx-btn lx-btn-ghost">
            Open the Mini App
          </Outbound>
          <Outbound href={surface.botUrl} className="lx-link text-sm">
            Message @LuminaraSuiteBot
          </Outbound>
        </div>
      );
    case 'android':
      return (
        <Outbound href={surface.storeUrl} className="lx-btn lx-btn-ghost">
          Get it on Google Play
        </Outbound>
      );
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

/** Quiet pills under the home hero. Web stays on this page. Telegram and Play leave the site. */
export function PlatformHeroLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-2 ${className}`}>
      <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--color-ink-2)] [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
        Available on
      </p>
      <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-2 p-0" aria-label="Available on">
        <li>
          <a href="#platforms" className={CHIP}>Web</a>
        </li>
        <li>
          <Outbound href={TELEGRAM_MINI_APP_PUBLIC_URL} className={CHIP}>Telegram</Outbound>
        </li>
        <li>
          <Outbound href={PLAY_STORE_URL} className={CHIP}>Google Play</Outbound>
        </li>
      </ul>
    </div>
  );
}

/** Selling row for web, Telegram, and the Play companion. Same glass cards as the rest of the landing. */
export function PlatformSurfaces({ onCheckSite }: { onCheckSite: () => void }) {
  return (
    <section
      id="platforms"
      aria-labelledby="platforms-heading"
      className="relative z-10 border-t lx-hairline px-5 py-16 sm:px-8 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Where to use it</p>
          <h2 id="platforms-heading" className="lx-display lx-h3 mt-5">
            On the web, in Telegram, <span className="italic lx-gold-text">and on Android.</span>
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ink-2)]">
            Card upgrades stay on this site. Stars checkout stays in Telegram. The Play app is free and syncs a signed-in plan.{' '}
            <a href="/desktop" className="lx-link">The Windows app</a>
            {' '}is the same product on a PC.
          </p>
        </div>
        <ul className="m-0 mt-12 grid list-none gap-6 p-0 md:grid-cols-3">
          {PLATFORM_SURFACES.map((surface, index) => (
            <li
              key={surface.id}
              className="lx-glass rounded-2xl p-6"
              data-reveal
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-[var(--gold-light)]">{surface.label}</p>
              <h3 className="mt-3 text-lg font-medium text-[var(--color-ink)]">{surface.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{surface.body}</p>
              <div className="mt-6">
                <PlatformCta surface={surface} onCheckSite={onCheckSite} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
