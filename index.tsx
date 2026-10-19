import './utils/bufferPolyfill';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTelegram } from './services/telegram/tma';
import { loadServerHealth } from './services/apiClient';
import { dismissBootSplash } from './services/intro/bootSplash';
import { initBrowserSentry } from './services/observability/sentryBrowser';
import './tokens.css';
import './index.css';

initBrowserSentry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Mount React immediately: zero delay for landing page and application shell
const root = createRoot(rootElement!);
root.render(
  <React.StrictMode>
    <ErrorBoundary scope="root">
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
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

