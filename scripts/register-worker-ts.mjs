import { register } from 'node:module';

register(new URL('./resolve-worker-ts.mjs', import.meta.url), { parentURL: import.meta.url });
