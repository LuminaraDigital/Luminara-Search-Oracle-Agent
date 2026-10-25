/** Stars checkout inside a Mini App. */

export type StarsPayStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

/** How long to wait for invoiceClosed. A missing callback must not pin "Opening checkout…". */
export const STARS_INVOICE_WAIT_MS = 120_000;

export interface TelegramInvoiceHost {
  platform?: string;
  openInvoice?: (url: string, callback: (status: string) => void) => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, cb: (payload: { status?: string } | string) => void) => void;
  offEvent?: (event: string, cb: (payload: { status?: string } | string) => void) => void;
}

export function normalizeStarsStatus(status: string | undefined): StarsPayStatus {
  if (status === 'paid' || status === 'cancelled' || status === 'failed' || status === 'pending') return status;
  return 'pending';
}

/**
 * iOS and Android deliver openInvoice. Desktop and Web drop that call once the
 * invoice URL was fetched (the click gesture is gone) and never call back.
 * openTelegramLink still opens a t.me invoice inside those clients.
 */
export function prefersInvoiceLink(platform: string | undefined): boolean {
  const name = (platform || '').toLowerCase();
  return name !== 'ios' && name !== 'android';
}

function eventStatus(payload: { status?: string } | string): string | undefined {
  return typeof payload === 'string' ? payload : payload?.status;
}

function waitForNativeInvoice(host: TelegramInvoiceHost, invoiceUrl: string): Promise<StarsPayStatus> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (status: StarsPayStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      host.offEvent?.('invoiceClosed', onEvent);
      resolve(status);
    };
    const onEvent = (payload: { status?: string } | string) => {
      finish(normalizeStarsStatus(eventStatus(payload)));
    };
    const timer = setTimeout(() => finish('pending'), STARS_INVOICE_WAIT_MS);
    try {
      host.onEvent?.('invoiceClosed', onEvent);
      host.openInvoice?.(invoiceUrl, (status) => finish(normalizeStarsStatus(status)));
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        host.offEvent?.('invoiceClosed', onEvent);
      }
      reject(err);
    }
  });
}

export async function openStarsInvoice(
  invoiceUrl: string,
  host: TelegramInvoiceHost | null,
  openExternal: (url: string) => void,
): Promise<StarsPayStatus> {
  const url = invoiceUrl.trim();
  if (!url) return 'failed';
  if (!host) {
    openExternal(url);
    return 'pending';
  }

  if (!prefersInvoiceLink(host.platform) && host.openInvoice) {
    try {
      return await waitForNativeInvoice(host, url);
    } catch {
      /* The sheet did not open. The invoice link is the next try. */
    }
  }

  if (host.openTelegramLink) {
    try {
      host.openTelegramLink(url);
      return 'pending';
    } catch {
      /* try the native invoice call, then the browser */
    }
  }

  if (host.openInvoice) {
    try {
      return await waitForNativeInvoice(host, url);
    } catch {
      /* fall through */
    }
  }

  openExternal(url);
  return 'pending';
}
