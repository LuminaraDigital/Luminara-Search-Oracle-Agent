/**
 * Terms sentences shared by the in-app page and the Worker HTML.
 * LEGAL_ABN is the display form. Digits 90693125281 pass the ATO checksum.
 */

export const LEGAL_ABN = '90 693 125 281';

export const PUBLIC_BRAND = 'Luminara Digital';

export const LEGAL_ENTITY = 'Luminara Digital Pty Ltd';

/** Terms, privacy, and footer. Do not add a tax line to this string. */
export const LEGAL_ENTITY_LINE = `${LEGAL_ENTITY} (ABN ${LEGAL_ABN})`;

export const COMPANY_SITE_URL = 'https://luminara.digital/';

export const COMPANY_SERVICES_URL = 'https://luminara.digital/services/';

export const ACL_RIGHTS_CLAUSE =
  'Nothing in these terms excludes, restricts or modifies rights you have under the Australian Consumer Law, including a refund or remedy for a major failure.';

export const STARS_REFUND_CLAUSE =
  'For a Stars refund, contact support@luminarasuite.com first. Telegram\'s process is how a Stars refund is paid. Refunds are subject to the Australian Consumer Law.';

export const LIABILITY_CLAUSE =
  'Subject to the Australian Consumer Law, the service is provided as is. To the extent the Australian Consumer Law allows, Luminara Digital Pty Ltd is not liable for indirect or consequential losses arising from use of the service.';

/** Empty when the ABN is blank, so the line is omitted rather than shown as "ABN ". */
export function legalAbnLine(abn: string = LEGAL_ABN): string {
  const value = abn.trim();
  return value ? `ABN ${value}` : '';
}
