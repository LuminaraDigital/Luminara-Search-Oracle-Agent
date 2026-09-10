/**
 * Node's Buffer is used by @ton/core (and thus PaywallModal / TonConnect paths).
 * Browsers do not provide it; install the npm `buffer` shim on globalThis once at boot.
 */
import { Buffer } from 'buffer';

type BufferHost = typeof globalThis & { Buffer?: typeof Buffer };

const host = globalThis as BufferHost;
if (!host.Buffer) {
  host.Buffer = Buffer;
}

export { Buffer };
