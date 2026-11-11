/**
 * Browser half of the hero experiment. The worker does not import this file.
 * It reads the cookie the HTML response just set, and the data-hero-ab flag.
 */
import { heroVariantFromCookie, type HeroVariant } from './heroExperiment';

export function heroExperimentOn(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.heroAb === 'on';
}

/** Cookie when the experiment is on. Otherwise employee, including a missing cookie. */
export function heroVariantInBrowser(): HeroVariant {
  if (!heroExperimentOn()) return 'employee';
  return heroVariantFromCookie(document.cookie) ?? 'employee';
}

/** Attached to signup_completed only while the experiment is on. */
export function signupHeroData(): { variant: HeroVariant } | Record<string, never> {
  if (!heroExperimentOn()) return {};
  return { variant: heroVariantFromCookie(document.cookie) ?? 'employee' };
}
