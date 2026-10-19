import React from 'react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { tonConnectManifestUrl } from '../../services/ton/connectManifest';
import { PaywallModal } from './PaywallModal';

/**
 * Loaded only after a paywall event. The provider stays with the modal so the
 * entry chunk does not import @tonconnect.
 */
export function PaywallWithTon({
  bootReason,
  onClose,
  onOpenSettings,
}: {
  bootReason?: string;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl()}>
      <PaywallModal isOpen bootReason={bootReason} onClose={onClose} onOpenSettings={onOpenSettings} />
    </TonConnectUIProvider>
  );
}
