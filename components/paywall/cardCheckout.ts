import { productTelemetry } from '../../services/analytics/productTelemetry';
import { createStripeCheckout } from '../../services/apiClient';
import { toUserFacingText } from '../../utils/userFacingText';

/** Starts the card checkout the paywall already uses, then leaves for Stripe. */
export async function redirectToCardCheckout(planId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await createStripeCheckout({ planId });
    if (res.ok && res.checkoutUrl) {
      productTelemetry.track('checkout_started', { planId, method: 'stripe', status: 'initiated' });
      window.location.assign(res.checkoutUrl);
      return { ok: true };
    }
    return { ok: false, error: toUserFacingText(res.error, 'Could not initiate Stripe checkout. Please try again.') };
  } catch (err: unknown) {
    return { ok: false, error: toUserFacingText(err, 'Failed to start card checkout.') };
  }
}
