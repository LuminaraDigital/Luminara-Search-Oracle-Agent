import React from 'react';
import { TonConnectButton, TonConnectUIProvider, useTonWallet } from '@tonconnect/ui-react';
import { tonConnectManifestUrl } from '../../services/ton/connectManifest';
import { TelegramAccountBody, type TelegramAccountPanelProps } from './TelegramAccountPanel';

function TonFace(props: TelegramAccountPanelProps) {
  const wallet = useTonWallet();
  return (
    <TelegramAccountBody
      {...props}
      wallet={wallet}
      connectSlot={<TonConnectButton />}
    />
  );
}

/**
 * shortcut: this provider is separate from the paywall's, hoist one provider when both can mount.
 * Loaded only when TON checkout is open, so a guest pricing page does not download TonConnect.
 */
export function TelegramAccountTon(props: TelegramAccountPanelProps) {
  return (
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl()}>
      <TonFace {...props} />
    </TonConnectUIProvider>
  );
}
