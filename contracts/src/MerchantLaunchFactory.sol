// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LoyaltyVoucherToken.sol";
import "./MilestonePreorderEscrow.sol";

/**
 * @title MerchantLaunchFactory
 * @notice Factory deployer for non-custodial SMB loyalty tokens and milestone escrows.
 * Deploys isolated, non-upgradeable contracts owned directly by the merchant.
 *
 * Invariants:
 * - Deployment fee must be paid exactly. Fees accrue here and are pulled to platformFeeRecipient
 *   via withdrawFees(), so a reverting recipient can never block merchant deployments.
 * - defaultPlatformFeeBps <= MAX_PLATFORM_FEE_BPS (5%), enforced in the setter and in every escrow.
 * - Loyalty tokens are always deployed transfer-restricted (closed loop: to/from merchant only).
 * - Ownership moves only via two-step transferOwnership + acceptOwnership.
 */
contract MerchantLaunchFactory {
    uint16 public constant MAX_PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant MAX_MILESTONES = 10;
    uint256 public constant MIN_CHALLENGE_WINDOW = 1 days;
    uint256 public constant MAX_CHALLENGE_WINDOW = 30 days;

    address public owner;
    address public pendingOwner;
    address public platformFeeRecipient;
    uint256 public deploymentFee; // In native currency (e.g., 50 XDC or ~0.01 POL)
    uint16 public defaultPlatformFeeBps = 250; // 2.5%
    uint256 public accruedFees;

    event LoyaltyTokenDeployed(
        address indexed tokenAddress,
        address indexed merchant,
        string name,
        string symbol,
        uint256 maxSupply
    );

    event PreorderEscrowDeployed(
        address indexed escrowAddress,
        address indexed merchant,
        uint256 softCap,
        uint256 hardCap,
        uint256 fundingDeadline,
        uint256 deliveryDeadline,
        uint256 challengeWindow
    );

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DeploymentFeeUpdated(uint256 newFee);
    event PlatformFeeRecipientUpdated(address indexed newRecipient);
    event DefaultPlatformFeeBpsUpdated(uint16 newBps);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error Unauthorized();
    error ZeroAddress();
    error IncorrectFee();
    error FeeTooHigh();
    error InvalidDuration();
    error InvalidChallengeWindow();
    error InvalidMilestones();
    error NothingToWithdraw();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier collectsFee() {
        if (msg.value != deploymentFee) revert IncorrectFee();
        accruedFees += msg.value;
        _;
    }

    constructor(address _platformFeeRecipient, uint256 _deploymentFee) {
        if (_platformFeeRecipient == address(0)) revert ZeroAddress();
        owner = msg.sender;
        platformFeeRecipient = _platformFeeRecipient;
        deploymentFee = _deploymentFee;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ----- Admin -----

    function setDeploymentFee(uint256 _newFee) external onlyOwner {
        deploymentFee = _newFee;
        emit DeploymentFeeUpdated(_newFee);
    }

    function setPlatformFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert ZeroAddress();
        platformFeeRecipient = _newRecipient;
        emit PlatformFeeRecipientUpdated(_newRecipient);
    }

    function setDefaultPlatformFeeBps(uint16 _newBps) external onlyOwner {
        if (_newBps > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        defaultPlatformFeeBps = _newBps;
        emit DefaultPlatformFeeBpsUpdated(_newBps);
    }

    /// @notice Step 1 of 2. Passing address(0) cancels a pending transfer.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2. Must be called by the pending owner.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Sends all accrued deployment fees to platformFeeRecipient. Callable by anyone.
    function withdrawFees() external {
        uint256 amount = accruedFees;
        if (amount == 0) revert NothingToWithdraw();
        accruedFees = 0;
        address recipient = platformFeeRecipient;
        emit FeesWithdrawn(recipient, amount);
        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ----- Deployers -----

    /**
     * @notice Deploys a new transfer-restricted LoyaltyVoucherToken owned by caller.
     */
    function deployLoyaltyToken(
        string calldata name,
        string calldata symbol,
        uint256 initialSupply,
        uint256 maxSupply
    ) external payable collectsFee returns (address) {
        LoyaltyVoucherToken token = new LoyaltyVoucherToken(
            name,
            symbol,
            initialSupply,
            maxSupply,
            msg.sender,
            false // closed loop: always transfer-restricted
        );

        emit LoyaltyTokenDeployed(address(token), msg.sender, name, symbol, maxSupply);
        return address(token);
    }

    /**
     * @notice Deploys a new MilestonePreorderEscrow managed by caller.
     * @param fundingDuration Seconds until pledging closes (> 0).
     * @param deliveryDeadline Absolute unix timestamp, after the funding deadline.
     * @param challengeWindow Seconds per milestone challenge window (1 to 30 days).
     * @param milestoneBps 1 to 10 payout shares in bps, summing to 10000.
     */
    function deployPreorderEscrow(
        uint256 softCap,
        uint256 hardCap,
        uint256 fundingDuration,
        uint256 deliveryDeadline,
        uint256 challengeWindow,
        uint16[] calldata milestoneBps
    ) external payable collectsFee returns (address) {
        if (fundingDuration == 0) revert InvalidDuration();
        uint256 fundingDeadline = block.timestamp + fundingDuration;
        if (deliveryDeadline <= fundingDeadline) revert InvalidDuration();
        if (challengeWindow < MIN_CHALLENGE_WINDOW || challengeWindow > MAX_CHALLENGE_WINDOW) {
            revert InvalidChallengeWindow();
        }
        if (milestoneBps.length == 0 || milestoneBps.length > MAX_MILESTONES) revert InvalidMilestones();

        MilestonePreorderEscrow escrow = new MilestonePreorderEscrow(
            msg.sender,
            platformFeeRecipient,
            defaultPlatformFeeBps,
            softCap,
            hardCap,
            fundingDuration,
            deliveryDeadline,
            challengeWindow,
            milestoneBps
        );

        emit PreorderEscrowDeployed(
            address(escrow),
            msg.sender,
            softCap,
            hardCap,
            fundingDeadline,
            deliveryDeadline,
            challengeWindow
        );
        return address(escrow);
    }
}
