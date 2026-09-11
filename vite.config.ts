import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// Secrets are intentionally NOT inlined here. Vite exposes VITE_-prefixed variables via
// import.meta.env, and anything exposed that way ships to every visitor's browser. Keys entered in
// the Settings modal live in localStorage only; hosted keys live in the Cloudflare Worker.
//
// Two safety nets keep a developer's local .env out of the public bundle:
//   1. In production builds every VITE_ variable whose name looks like a credential is blanked.
//   2. A post-build scan fails the build if an emitted chunk contains a known API-key shape.
//
// Dev-only proxies below let the browser use the same /api/sidecars/<id>/... relay paths the
// Cloudflare Worker serves in production, without running the Worker. The targets and the Umami
// key are read from non-VITE_ variables in .env (server side only, never bundled).

const SECRET_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|ORG_ID)/i;
// Firebase web config (VITE_FIREBASE_API_KEY etc.) is public by design and must reach the browser.
const PUBLIC_NAME_RE = /^VITE_FIREBASE_/;
// Gemini keys are blanked by name above; an AIza-shaped value left in the bundle is Firebase's public key.
const SECRET_VALUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'GitHub token', re: /\b(gho_|ghp_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { label: 'Groq key', re: /gsk_[A-Za-z0-9]{20,}/ },
  { label: 'NVIDIA key', re: /nvapi-[A-Za-z0-9_-]{20,}/ },
  { label: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { label: 'Tavily key', re: /tvly-[A-Za-z0-9-]{20,}/ },
  { label: 'Firecrawl key', re: /\bfc-[a-f0-9]{30,}/ },
  { label: 'Browserbase key', re: /bb_live_[A-Za-z0-9_-]{20,}/ },
  { label: 'Telegram bot token', re: /\b\d{8,}:[A-Za-z0-9_-]{30,}/ },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

/** Fails `vite build` when a bundle contains something shaped like a live credential. */
function secretLeakGuard(): Plugin {
  return {
    name: 'luminara-secret-leak-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        const code = chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : '';
        if (!code) continue;
        for (const { label, re } of SECRET_VALUE_PATTERNS) {
          if (re.test(code)) {
            this.error(
              `Refusing to emit ${fileName}: it contains what looks like a ${label}. ` +
                'Remove VITE_*_API_KEY values from .env before building (keys belong in the Worker or in Settings).'
            );
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const languageToolUrl = env.LANGUAGETOOL_URL || 'http://localhost:8010';
  const umamiUrl = env.UMAMI_URL || 'http://localhost:3002';
  const umamiApiKey = env.UMAMI_API_KEY || '';
  const isProduction = mode === 'production';

  // Production: blank every credential-looking VITE_ variable so the inlined import.meta.env
  // object never carries a developer's local keys. Non-secret VITE_ config (URLs, API base) is kept.
  const define: Record<string, string> = {};
  if (isProduction) {
    for (const name of Object.keys(env)) {
      if (name.startsWith('VITE_') && !PUBLIC_NAME_RE.test(name) && SECRET_NAME_RE.test(name) && env[name]) {
        define[`import.meta.env.${name}`] = '""';
      }
    }
  }

  return {
    // @ton/core expects Node globals in the browser bundle.
    define: {
      ...define,
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['buffer'],
    },
    server: {
      port: 3000,
      // Bind to loopback by default: the dev server proxies the Umami key and must not be reachable
      // by other machines on the network. Set VITE_DEV_HOST=0.0.0.0 to expose it deliberately.
      host: env.VITE_DEV_HOST || 'localhost',
      proxy: {
        '/api/nim-proxy': {
          target: 'https://integrate.api.nvidia.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api\/nim-proxy/, ''),
        },
        // Writing check (LanguageTool): /api/sidecars/languagetool/v2/check -> <LANGUAGETOOL_URL>/v2/check
        '/api/sidecars/languagetool': {
          target: languageToolUrl,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api\/sidecars\/languagetool/, ''),
        },
        // Results tracking (Umami): /api/sidecars/umami/api/websites -> <UMAMI_URL>/api/websites
        '/api/sidecars/umami': {
          target: umamiUrl,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api\/sidecars\/umami/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (!umamiApiKey) return;
              // Umami Cloud reads x-umami-api-key; self-hosted Umami reads a bearer token.
              proxyReq.setHeader('x-umami-api-key', umamiApiKey);
              proxyReq.setHeader('authorization', `Bearer ${umamiApiKey}`);
            });
          },
        },
        // Local Vite has no Worker. Relay remaining /api/* (providers, health, auth) to production
        // (or VITE_API_BASE) so Settings BYOK tests work without `wrangler dev`.
        '/api': {
          target: env.VITE_API_BASE || 'https://luminarasuite.com',
          changeOrigin: true,
          secure: true,
        },
      },
    },
    plugins: [react(), wasm(), secretLeakGuard()],
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 900,
      // Do not modulepreload the Forme PDF/WASM chunk on every visit; it is only used on export.
      modulePreload: {
        resolveDependencies: (_filename, deps) =>
          deps.filter((dep) => !/(^|\/)pdf[^/]*\.js$/i.test(dep) && !/pdfService/i.test(dep)),
      },
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            genai: ['@google/genai'],
            markdown: ['marked', 'dompurify'],
            pdf: ['@formepdf/core', '@formepdf/react'],
            tonconnect: ['@tonconnect/ui-react'],
            firebase: ['firebase/app', 'firebase/auth'],
            telegram: ['@telegram-apps/sdk-react'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        buffer: 'buffer/',
      },
    },
  };
});
