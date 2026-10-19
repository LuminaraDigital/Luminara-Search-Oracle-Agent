import './utils/bufferPolyfill';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTelegram } from './services/telegram/tma';
import { loadServerHealth } from './services/apiClient';
import { dismissBootSplash } from './services/intro/bootSplash';
import { bindFirstPaintDismissal } from './services/marketing/releaseFirstPaint';
import { installDialogFocus } from './services/a11y/dialogFocus';
import { initBrowserSentry } from './services/observability/sentryBrowser';
import './tokens.css';
import './index.css';

initBrowserSentry();
installDialogFocus();
bindFirstPaintDismissal();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** Splash stays up until this commits, so a slow bundle never fades onto an empty root. */
function ReleaseBootSplash() {
  React.useEffect(() => {
    dismissBootSplash(0);
  }, []);
  return null;
}

const root = createRoot(rootElement!);
root.render(
  <React.StrictMode>
    <ReleaseBootSplash />
    <ErrorBoundary scope="root">
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
    </ErrorBoundary>
  </React.StrictMode>
);

// Non-blocking background initialization (Telegram environment + server provider health)
Promise.allSettled([initTelegram(), loadServerHealth()]).catch((err) => {
  console.warn('[boot] background services init warning:', err);
});

