import React, { Suspense, useEffect, useState } from 'react';
import { lazyWithReload } from '../../utils/lazyWithReload';
import { toUserFacingText } from '../../utils/userFacingText';

const PaywallWithTon = lazyWithReload(() =>
  import('./PaywallWithTon').then((m) => ({ default: m.PaywallWithTon })),
);

/** Mounts checkout only after luminara-open-paywall, so guests never download TonConnect. */
export function PaywallSlot({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [bootReason, setBootReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onPaywall = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: unknown }>).detail;
      setBootReason(toUserFacingText(detail?.reason, 'You have reached your daily free AI request limit.'));
      setOpen(true);
    };
    window.addEventListener('luminara-open-paywall', onPaywall);
    return () => window.removeEventListener('luminara-open-paywall', onPaywall);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PaywallWithTon
        bootReason={bootReason ?? undefined}
        onOpenSettings={onOpenSettings}
        onClose={() => setOpen(false)}
      />
    </Suspense>
  );
}
