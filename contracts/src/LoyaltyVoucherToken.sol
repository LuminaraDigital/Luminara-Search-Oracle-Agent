// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LoyaltyVoucherToken
 * @notice Closed-loop consumer loyalty and voucher token.
 * Non-financial utility token redeemable exclusively for merchant goods and services.
 * Carries no entitlement to dividends, revenue shares, equity, or staking yields.
 *
 * Invariants:
 * - totalSupply <= maxSupply at all times.
 * - Only the merchant can mint. Anyone can burn their own balance via redeem().
 * - When `transferable` is false, every transfer must have the merchant as sender or recipient
 *   (closed loop: customers cannot trade vouchers with each other).
 */
contract LoyaltyVoucherToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public immutable merchant;
    uint256 public immutable maxSupply;
    bool public immutable transferable;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event VoucherRedeemed(address indexed customer, uint256 amount, string voucherCode, uint256 timestamp);

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ExceedsMaxSupply();
    error ZeroAddress();
    error ZeroAmount();
    error TransferRestricted();

    modifier onlyMerchant() {
        if (msg.sender != merchant) revert Unauthorized();
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _maxSupply,
        address _merchant,
        bool _transferable
    ) {
        if (_merchant == address(0)) revert ZeroAddress();
        if (_maxSupply == 0 || _initialSupply > _maxSupply) revert ExceedsMaxSupply();

        name = _name;
        symbol = _symbol;
        merchant = _merchant;
        maxSupply = _maxSupply;
        transferable = _transferable;

        if (_initialSupply > 0) {
            totalSupply = _initialSupply;
            balanceOf[_merchant] = _initialSupply;
            emit Transfer(address(0), _merchant, _initialSupply);
        }
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @dev Approving the zero address reverts. Overwrites the previous allowance (standard ERC-20).
    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @dev An allowance of type(uint256).max is treated as infinite and is not decremented.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            if (current < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = current - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Burns loyalty tokens upon point-of-sale customer redemption.
     */
    function redeem(uint256 amount, string calldata voucherCode) external returns (bool) {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();

        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply -= amount; // totalSupply >= any single balance
        }

        emit Transfer(msg.sender, address(0), amount);
        emit VoucherRedeemed(msg.sender, amount, voucherCode, block.timestamp);
        return true;
    }

    /**
     * @notice Allows merchant to issue additional reward tokens up to the max supply cap.
     */
    function mint(address recipient, uint256 amount) external onlyMerchant returns (bool) {
        if (recipient == address(0)) revert ZeroAddress();
        // Subtraction form cannot overflow, unlike totalSupply + amount.
        if (amount > maxSupply - totalSupply) revert ExceedsMaxSupply();

        totalSupply += amount;
        balanceOf[recipient] += amount;
        emit Transfer(address(0), recipient, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (!transferable && from != merchant && to != merchant) revert TransferRestricted();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();

        unchecked {
            balanceOf[from] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
