import React from 'react';
import { createRoot } from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTelegram } from './services/telegram/tma';
import { loadServerHealth } from './services/apiClient';
import { dismissBootSplash } from './services/intro/bootSplash';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

function getSafeManifestUrl(): string {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (origin && origin !== 'null' && (origin.startsWith('http://') || origin.startsWith('https://'))) {
      return new URL('tonconnect-manifest.json', origin).toString();
    }
  } catch {
    /* fallback */
  }
  return 'https://www.luminarasuite.com/tonconnect-manifest.json';
}

const manifestUrl = getSafeManifestUrl();

// Mount React immediately: zero delay for landing page and application shell
const root = createRoot(rootElement!);
root.render(
  <React.StrictMode>
    <ErrorBoundary scope="root">
      <TonConnectUIProvider manifestUrl={manifestUrl}>
        <ErrorBoundary scope="app">
          <App />
        </ErrorBoundary>
      </TonConnectUIProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Dismiss the HTML boot splash smoothly right after the initial React render
requestAnimationFrame(() => dismissBootSplash(60));
// Automatic failsafe: guarantee boot splash is dismissed within 1.5 seconds regardless
setTimeout(() => dismissBootSplash(0), 1500);

// Non-blocking background initialization (Telegram environment + server provider health)
Promise.allSettled([initTelegram(), loadServerHealth()]).catch((err) => {
  console.warn('[boot] background services init warning:', err);
});

