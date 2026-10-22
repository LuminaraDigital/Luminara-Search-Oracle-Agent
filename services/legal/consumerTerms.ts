/**
 * Terms sentences shared by the in-app page and the Worker HTML.
 * LEGAL_ABN is the display form. Digits 90693125281 pass the ATO checksum.
 */
import { PAID_PLAN_PRICES } from '../../components/paywall/planPrices';
import { PLAN_ENTITLEMENTS } from '../plans/planEntitlements';

export const LEGAL_ABN = '90 693 125 281';

export const PUBLIC_BRAND = 'Luminara Digital';

export const LEGAL_ENTITY = 'LUMINARA DIGITAL PTY LTD';

/** Terms, privacy, and footer. Do not add a tax line to this string. */
export const LEGAL_ENTITY_LINE = `${LEGAL_ENTITY} (ABN ${LEGAL_ABN})`;

/** Suburb and state only. No street address. */
export const BUSINESS_LOCATION = 'Victoria 3128, Australia';

export const OPERATOR_LINE = `${LEGAL_ENTITY_LINE}, trading as ${PUBLIC_BRAND}, ${BUSINESS_LOCATION}`;

export const CONTACT_EMAIL = 'info@luminara.digital';

export const PUBLIC_CONTACT_LINE = `Email ${CONTACT_EMAIL}.`;

export const COMPANY_SITE_URL = 'https://luminara.digital/';

export const COMPANY_SERVICES_URL = 'https://luminara.digital/services/';

export const ACL_RIGHTS_CLAUSE =
  'Nothing in these terms excludes, restricts or modifies rights you have under the Australian Consumer Law, including a refund or remedy for a major failure.';

export const TERMS_UPDATED = '23 October 2026';

export const STARS_REFUND_CLAUSE =
  'For a Stars refund, contact support@luminarasuite.com first. Telegram\'s process is how a Stars refund is paid. Refunds are subject to the Australian Consumer Law.';

const CARD_PRICE_LIST = (['starter', 'growth', 'agency'] as const)
  .map((id) => `${PLAN_ENTITLEMENTS[id].title} ${PAID_PLAN_PRICES[id].audLabel}`)
  .join(', ');

/** Plans and payments. Same words on /terms and in the app. */
export const PLANS_PAYMENTS_PARAGRAPH =
  `Plans bought with Telegram Stars run for the stated number of days from purchase and do not renew automatically. ${STARS_REFUND_CLAUSE} Card checkout is through Stripe for a one-off 30-day pass in Australian dollars: ${CARD_PRICE_LIST}. A card pass does not renew. The Telegram Mini App takes Telegram Stars only. For a card refund, follow the FAQ refund policy and email ${CONTACT_EMAIL}. ${ACL_RIGHTS_CLAUSE}`;

export const LIABILITY_CLAUSE =
  `Subject to the Australian Consumer Law, the service is provided as is. To the extent the Australian Consumer Law allows, ${LEGAL_ENTITY} is not liable for indirect or consequential losses arising from use of the service.`;

/** Empty when the ABN is blank, so the line is omitted rather than shown as "ABN ". */
export function legalAbnLine(abn: string = LEGAL_ABN): string {
  const value = abn.trim();
  return value ? `ABN ${value}` : '';
}
