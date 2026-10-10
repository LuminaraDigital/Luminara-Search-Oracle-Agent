import { describe, it, expect, vi } from 'vitest';
import {
  normalizeContractSource,
  fetchVerifiedContract,
} from '../../worker/chain/evmExplorer';
import type { Env } from '../../worker/env';

describe('EVM Explorer Worker Edge Service', () => {
  describe('normalizeContractSource', () => {
    it('returns raw string for single-file contracts', () => {
      const single = 'contract MyToken { uint256 a; }';
      const res = normalizeContractSource(single);
      expect(res.mainSource).toBe(single);
      expect(res.isMultiPart).toBe(false);
    });

    it('extracts multi-part contracts wrapped in double braces {{ ... }}', () => {
      const multi = JSON.stringify({
        sources: {
          'contracts/Token.sol': { content: 'contract Token {}' },
          'contracts/IERC20.sol': { content: 'interface IERC20 {}' },
        },
      });
      const wrapped = `{${multi}}`; // Etherscan double curly format
      const res = normalizeContractSource(wrapped);
      expect(res.isMultiPart).toBe(true);
      expect(res.mainSource).toContain('// File: contracts/Token.sol');
      expect(res.mainSource).toContain('contract Token {}');
      expect(res.mainSource).toContain('// File: contracts/IERC20.sol');
    });

    it('handles empty or malformed inputs safely', () => {
      expect(normalizeContractSource('').mainSource).toBe('');
      expect(normalizeContractSource('   ').mainSource).toBe('');
    });
  });

  describe('fetchVerifiedContract', () => {
    it('rejects invalid EVM address formats', async () => {
      const mockEnv = {} as Env;
      const res = await fetchVerifiedContract(8453, 'invalid-address', mockEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.error).toContain('Invalid EVM address format');
      }
    });

    it('rejects unsupported chain IDs', async () => {
      const mockEnv = {} as Env;
      const res = await fetchVerifiedContract(999999, '0x140C07055B0B85efe91b80e765BCc24b3dd647d9', mockEnv);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.error).toContain('Unsupported chain ID');
      }
    });

    it('serves from KV cache when available without network fetch', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue({
          address: '0x140c07055b0b85efe91b80e765bcc24b3dd647d9',
          chainId: 8453,
          contractName: 'CachedContract',
          compilerVersion: 'v0.8.20',
          sourceCode: 'contract CachedContract {}',
          abi: [],
          verified: true,
        }),
        put: vi.fn(),
      };

      const mockEnv = {
        LUMINARA_KV: mockKv,
      } as unknown as Env;

      const res = await fetchVerifiedContract(8453, '0x140C07055B0B85efe91b80e765BCc24b3dd647d9', mockEnv);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.cached).toBe(true);
        expect(res.data.contractName).toBe('CachedContract');
      }
      expect(mockKv.get).toHaveBeenCalled();
    });
  });
});
