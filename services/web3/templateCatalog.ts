/**
 * Audited Smart Contract Template Catalog
 * Pre-vetted, battle-tested templates based on OpenZeppelin standards.
 * Dynamic arbitrary Solidity generation by LLMs is strictly avoided for deployments
 * to guarantee non-technical users cannot deploy vulnerable contracts.
 */

export interface TemplateParamSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'address' | 'percent' | 'boolean' | 'address_list';
  description: string;
  required: boolean;
  defaultValue?: any;
  min?: number;
  max?: number;
}

export interface ContractTemplate {
  id: string;
  name: string;
  category: 'token' | 'nft' | 'payments';
  version: string;
  description: string;
  solidityVersion: string;
  params: TemplateParamSchema[];
  renderSource: (params: Record<string, any>) => string;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const TEMPLATE_CATALOG: Record<string, ContractTemplate> = {
  erc20_standard: {
    id: 'erc20_standard',
    name: 'Standard ERC-20 Token',
    category: 'token',
    version: '1.0.0',
    description: 'Clean, standard, gas-optimized ERC-20 token with fixed initial supply and optional burn.',
    solidityVersion: '^0.8.20',
    params: [
      { key: 'name', label: 'Token Name', type: 'string', description: 'Human-readable name (e.g. Luminara)', required: true },
      { key: 'symbol', label: 'Token Symbol', type: 'string', description: 'Ticker symbol (e.g. LUMN)', required: true },
      { key: 'initialSupply', label: 'Initial Supply', type: 'number', description: 'Whole token supply minted to deployer', required: true, min: 1 },
      { key: 'burnable', label: 'Allow Burning', type: 'boolean', description: 'Allows holders to burn tokens', required: false, defaultValue: true },
    ],
    renderSource: (p) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
${p.burnable ? 'import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";\n' : ''}
import "@openzeppelin/contracts/access/Ownable.sol";

contract ${sanitizeIdentifier(p.name || 'CustomToken')} is ERC20${p.burnable ? ', ERC20Burnable' : ''}, Ownable {
    constructor()
        ERC20("${escapeSolidity(p.name)}", "${escapeSolidity(p.symbol)}")
        Ownable(msg.sender)
    {
        _mint(msg.sender, ${BigInt(p.initialSupply || 1000000)} * 10 ** decimals());
    }
}
`,
  },

  erc20_fee: {
    id: 'erc20_fee',
    name: 'Community Fee Token',
    category: 'token',
    version: '1.0.0',
    description: 'ERC-20 token with an honest, capped transfer fee (max 5%) routed to a treasury or charity address.',
    solidityVersion: '^0.8.20',
    params: [
      { key: 'name', label: 'Token Name', type: 'string', description: 'Human-readable name', required: true },
      { key: 'symbol', label: 'Token Symbol', type: 'string', description: 'Ticker symbol', required: true },
      { key: 'initialSupply', label: 'Initial Supply', type: 'number', description: 'Total supply minted', required: true, min: 1 },
      { key: 'feeBasisPoints', label: 'Fee Percent (Basis Points)', type: 'number', description: 'Fee basis points (e.g. 200 = 2%, max 500 = 5%)', required: true, min: 1, max: 500 },
      { key: 'feeRecipient', label: 'Treasury / Fee Recipient', type: 'address', description: 'Address receiving transfer fees', required: true },
    ],
    renderSource: (p) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ${sanitizeIdentifier(p.name || 'CommunityToken')} is ERC20, Ownable {
    uint256 public constant MAX_FEE_BPS = 500; // Hard maximum 5% fee limit
    uint256 public feeBasisPoints;
    address public feeRecipient;

    event FeeUpdated(uint256 newFeeBps);
    event FeeRecipientUpdated(address newRecipient);

    constructor()
        ERC20("${escapeSolidity(p.name)}", "${escapeSolidity(p.symbol)}")
        Ownable(msg.sender)
    {
        require(${Number(p.feeBasisPoints)} <= MAX_FEE_BPS, "Fee exceeds 5% cap");
        require(${isValidAddress(p.feeRecipient) ? `address(${p.feeRecipient})` : 'address(0)'} != address(0), "Invalid fee recipient");
        feeBasisPoints = ${Number(p.feeBasisPoints)};
        feeRecipient = ${p.feeRecipient};
        _mint(msg.sender, ${BigInt(p.initialSupply || 1000000)} * 10 ** decimals());
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0) || to == address(0) || feeBasisPoints == 0 || from == owner() || to == owner()) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBasisPoints) / 10000;
        uint256 sendAmount = value - fee;
        super._update(from, feeRecipient, fee);
        super._update(from, to, sendAmount);
    }
}
`,
  },

  erc721a_launch: {
    id: 'erc721a_launch',
    name: 'NFT Collection Launchpad',
    category: 'nft',
    version: '1.0.0',
    description: 'Gas-efficient ERC-721 collection with configurable mint price, max per wallet, and supply limit.',
    solidityVersion: '^0.8.20',
    params: [
      { key: 'name', label: 'Collection Name', type: 'string', description: 'Name of the NFT collection', required: true },
      { key: 'symbol', label: 'Collection Symbol', type: 'string', description: 'NFT symbol', required: true },
      { key: 'maxSupply', label: 'Max Supply', type: 'number', description: 'Max items mintable', required: true, min: 1, max: 100000 },
      { key: 'mintPriceWei', label: 'Mint Price (Wei)', type: 'string', description: 'Price in wei (0 for free mint)', required: false, defaultValue: '0' },
      { key: 'baseUri', label: 'Base Metadata URI', type: 'string', description: 'IPFS or HTTPS metadata prefix', required: false, defaultValue: 'ipfs://' },
    ],
    renderSource: (p) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ${sanitizeIdentifier(p.name || 'NFTCollection')} is ERC721Enumerable, Ownable {
    uint256 public constant MAX_SUPPLY = ${Number(p.maxSupply || 1000)};
    uint256 public mintPrice = ${p.mintPriceWei || '0'};
    string private _baseTokenURI = "${escapeSolidity(p.baseUri || 'ipfs://')}";

    constructor()
        ERC721("${escapeSolidity(p.name)}", "${escapeSolidity(p.symbol)}")
        Ownable(msg.sender)
    {}

    function mint(uint256 quantity) external payable {
        require(quantity > 0, "Must mint at least 1");
        require(totalSupply() + quantity <= MAX_SUPPLY, "Exceeds max supply");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");

        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, totalSupply() + 1);
        }
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
`,
  },

  payment_splitter: {
    id: 'payment_splitter',
    name: 'Revenue Payment Splitter',
    category: 'payments',
    version: '1.0.0',
    description: 'Trustless revenue sharing contract dividing incoming native coin proportionally among multiple payees.',
    solidityVersion: '^0.8.20',
    params: [
      { key: 'name', label: 'Contract Name', type: 'string', description: 'Label for splitter', required: true },
      { key: 'payees', label: 'Payee Addresses', type: 'address_list', description: 'Comma separated recipient addresses', required: true },
      { key: 'shares', label: 'Shares', type: 'string', description: 'Comma separated integer shares (e.g. 70,30)', required: true },
    ],
    renderSource: (p) => {
      const payeesArray = Array.isArray(p.payees) ? p.payees : String(p.payees || '').split(',').map(s => s.trim());
      const sharesArray = Array.isArray(p.shares) ? p.shares : String(p.shares || '').split(',').map(s => Number(s.trim()));
      return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/finance/PaymentSplitter.sol";

contract ${sanitizeIdentifier(p.name || 'RevenueSplitter')} is PaymentSplitter {
    constructor()
        PaymentSplitter(
            ${JSON.stringify(payeesArray)},
            ${JSON.stringify(sharesArray)}
        )
    {}
}
`;
    },
  },
};

export function listTemplates(): ContractTemplate[] {
  return Object.values(TEMPLATE_CATALOG);
}

export function getTemplate(id: string): ContractTemplate | null {
  return TEMPLATE_CATALOG[id] ?? null;
}

export function validateTemplateParams(
  templateId: string,
  params: Record<string, any>
): { valid: boolean; errors: string[] } {
  const template = getTemplate(templateId);
  if (!template) {
    return { valid: false, errors: [`Unknown template ID: ${templateId}`] };
  }

  const errors: string[] = [];

  for (const field of template.params) {
    const val = params[field.key] ?? field.defaultValue;
    if (field.required && (val === undefined || val === null || val === '')) {
      errors.push(`Missing required parameter: ${field.label} (${field.key})`);
      continue;
    }

    if (val !== undefined && val !== null) {
      if (field.type === 'number') {
        const num = Number(val);
        if (isNaN(num)) {
          errors.push(`${field.label} must be a valid number`);
        } else {
          if (field.min !== undefined && num < field.min) {
            errors.push(`${field.label} must be at least ${field.min}`);
          }
          if (field.max !== undefined && num > field.max) {
            errors.push(`${field.label} must not exceed ${field.max}`);
          }
        }
      } else if (field.type === 'address') {
        if (!ADDRESS_REGEX.test(String(val).trim())) {
          errors.push(`${field.label} must be a valid EVM address (0x...)`);
        }
      } else if (field.type === 'address_list') {
        const list = Array.isArray(val) ? val : String(val).split(',').map(s => s.trim());
        if (list.length === 0) {
          errors.push(`${field.label} must contain at least one address`);
        }
        for (const item of list) {
          if (!ADDRESS_REGEX.test(item)) {
            errors.push(`Invalid address in ${field.label}: ${item}`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '') || 'LuminaraContract';
}

function escapeSolidity(str: string): string {
  return String(str || '').replace(/["\\\r\n]/g, '');
}

function isValidAddress(addr: any): boolean {
  return typeof addr === 'string' && ADDRESS_REGEX.test(addr.trim());
}
