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

// Mount React immediately: zero delay for landing page and application shell
const root = createRoot(rootElement!);
root.render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);

// Dismiss the HTML boot splash smoothly right after the initial React render
requestAnimationFrame(() => dismissBootSplash(60));

// Non-blocking background initialization (Telegram environment + server provider health)
Promise.allSettled([initTelegram(), loadServerHealth()]).catch((err) => {
  console.warn('[boot] background services init warning:', err);
});
