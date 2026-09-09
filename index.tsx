import React from 'react';
import { createRoot } from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import { initTelegram } from './services/telegram/tma';
import { loadServerHealth } from './services/apiClient';
import { dismissBootSplash } from './services/intro/bootSplash';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const manifestUrl = new URL('tonconnect-manifest.json', window.location.origin).toString();

async function bootstrap() {
  // Detect Telegram and learn which providers the Worker holds keys for, before first render.
  await Promise.all([initTelegram(), loadServerHealth()]);

  const root = createRoot(rootElement!);
  root.render(
    <React.StrictMode>
      <TonConnectUIProvider manifestUrl={manifestUrl}>
        <App />
      </TonConnectUIProvider>
    </React.StrictMode>
  );

  // Let the first paint land under the splash, then fade it so boot → intro/app feels continuous.
  requestAnimationFrame(() => dismissBootSplash(160));
}

bootstrap().catch((err) => {
  console.error('[boot] failed', err);
  dismissBootSplash(0);
});
