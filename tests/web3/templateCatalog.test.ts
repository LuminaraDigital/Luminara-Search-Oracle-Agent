import { describe, it, expect } from 'vitest';
import {
  listTemplates,
  getTemplate,
  validateTemplateParams,
} from '../../services/web3/templateCatalog';

describe('Web3 Template Catalog', () => {
  it('lists all registered smart contract templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(4);
    expect(templates.map((t) => t.id)).toContain('erc20_standard');
    expect(templates.map((t) => t.id)).toContain('erc20_fee');
    expect(templates.map((t) => t.id)).toContain('erc721a_launch');
    expect(templates.map((t) => t.id)).toContain('payment_splitter');
  });

  describe('erc20_standard', () => {
    it('validates required parameters', () => {
      const res = validateTemplateParams('erc20_standard', {
        name: 'Luminara Token',
        symbol: 'LUMN',
        initialSupply: 1000000,
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects missing token symbol or initial supply', () => {
      const res = validateTemplateParams('erc20_standard', {
        name: 'Luminara Token',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    it('renders clean Solidity source code', () => {
      const template = getTemplate('erc20_standard')!;
      const source = template.renderSource({
        name: 'Luminara Token',
        symbol: 'LUMN',
        initialSupply: 1000000,
        burnable: true,
      });
      expect(source).toContain('contract LuminaraToken is ERC20, ERC20Burnable, Ownable');
      expect(source).toContain('ERC20("Luminara Token", "LUMN")');
      expect(source).toContain('_mint(msg.sender, 1000000 * 10 ** decimals())');
    });
  });

  describe('erc20_fee', () => {
    it('enforces maximum 5% fee limit', () => {
      const invalidFee = validateTemplateParams('erc20_fee', {
        name: 'Community Token',
        symbol: 'COMM',
        initialSupply: 1000000,
        feeBasisPoints: 600, // 6% > 5% max
        feeRecipient: '0x1111111111111111111111111111111111111111',
      });
      expect(invalidFee.valid).toBe(false);
      expect(invalidFee.errors[0]).toContain('must not exceed 500');

      const validFee = validateTemplateParams('erc20_fee', {
        name: 'Community Token',
        symbol: 'COMM',
        initialSupply: 1000000,
        feeBasisPoints: 250, // 2.5%
        feeRecipient: '0x1111111111111111111111111111111111111111',
      });
      expect(validFee.valid).toBe(true);
    });

    it('rejects invalid recipient address', () => {
      const res = validateTemplateParams('erc20_fee', {
        name: 'Community Token',
        symbol: 'COMM',
        initialSupply: 1000000,
        feeBasisPoints: 200,
        feeRecipient: 'not-an-address',
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('must be a valid EVM address');
    });
  });

  describe('payment_splitter', () => {
    it('validates payee addresses list', () => {
      const res = validateTemplateParams('payment_splitter', {
        name: 'Splitter',
        payees: [
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
        ],
        shares: '60,40',
      });
      expect(res.valid).toBe(true);
    });
  });
});
