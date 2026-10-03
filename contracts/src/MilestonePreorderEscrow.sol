// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MilestonePreorderEscrow
 * @notice Milestone escrow for commercial service pre-orders and crowd vouchers.
 * Backer funds are released to the merchant one milestone at a time, and only after a
 * pledge-weighted challenge window passes without a majority objection.
 *
 * Lifecycle: Funding -> Active -> Completed, or Funding/Active -> Failed.
 *
 * Who can move funds, and when:
 * - Backers pledge native currency while Funding and before fundingDeadline.
 * - Milestones are sequential. The merchant submits proof for the current milestone
 *   (on or before deliveryDeadline), which opens a challenge window.
 * - Backers can object() once per milestone, weighted by pledge.
 *   Objection weight > 50% of totalPledged during the window fails the campaign.
 * - Anyone can disburse the current milestone only after the window closes (objection weight
 *   was <= 50%, otherwise the campaign already failed). Disbursement only credits balances (pull payments).
 * - Merchant and fee recipient pull credited funds with withdraw().
 * - If the delivery deadline passes and the current milestone has no proof, anyone can markFailed().
 * - On failure the undisbursed pool is snapshotted. Each backer can claim
 *   pledge * remainingPoolAtFailure / totalPledged exactly once (rounded down).
 */
contract MilestonePreorderEscrow {
    enum CampaignState { Funding, Active, Completed, Failed }

    struct Milestone {
        uint16 payoutBps;
        bool submitted;
        bool disbursed;
        uint64 challengeEndsAt;
        bytes32 proofHash;
        uint256 objectionWeight;
        string proofUri;
    }

    uint16 public constant MAX_PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant MAX_MILESTONES = 10;
    uint256 public constant MIN_CHALLENGE_WINDOW = 1 days;
    uint256 public constant MAX_CHALLENGE_WINDOW = 30 days;
    uint256 private constant BPS = 10_000;

    address public immutable merchant;
    address public immutable platformFeeRecipient;
    uint16 public immutable platformFeeBps;
    uint256 public immutable softCap;
    uint256 public immutable hardCap;
    uint256 public immutable fundingDeadline;
    uint256 public immutable deliveryDeadline;
    uint256 public immutable challengeWindow;

    CampaignState public state;
    uint256 public totalPledged;
    uint256 public totalDisbursed;
    uint256 public totalRefunded;
    uint256 public remainingPoolAtFailure;
    uint256 public currentMilestone;

    Milestone[] public milestones;
    mapping(address => uint256) public pledges;
    mapping(address => uint256) public refundedAmounts;
    mapping(address => uint256) public withdrawable;
    mapping(uint256 => mapping(address => bool)) public hasObjected;

    uint256 private _status = 1;

    event PledgeReceived(address indexed backer, uint256 amount, uint256 newTotal);
    event StateChanged(CampaignState newState);
    event MilestoneSubmitted(uint256 indexed milestoneIndex, string proofUri, bytes32 proofHash, uint256 challengeEndsAt);
    event MilestoneObjected(uint256 indexed milestoneIndex, address indexed backer, uint256 weight, uint256 totalObjectionWeight);
    event MilestoneDisbursed(uint256 indexed milestoneIndex, uint256 merchantAmount, uint256 platformFee);
    event CampaignFailed(uint256 remainingPoolAtFailure);
    event RefundClaimed(address indexed backer, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    error Unauthorized();
    error ReentrancyGuard();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidFee();
    error InvalidCap();
    error InvalidDuration();
    error InvalidChallengeWindow();
    error InvalidMilestones();
    error InvalidState();
    error FundingClosed();
    error FundingStillOpen();
    error HardCapExceeded();
    error MilestoneAlreadySubmitted();
    error MilestoneNotSubmitted();
    error MilestonePending();
    error DeliveryDeadlinePassed();
    error DeliveryDeadlineNotReached();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error NotBacker();
    error AlreadyObjected();
    error AlreadyRefunded();
    error NothingToRefund();
    error NothingToWithdraw();
    error TransferFailed();

    modifier nonReentrant() {
        if (_status == 2) revert ReentrancyGuard();
        _status = 2;
        _;
        _status = 1;
    }

    modifier inState(CampaignState expected) {
        if (state != expected) revert InvalidState();
        _;
    }

    /**
     * @param _fundingDuration Seconds from deployment until pledging closes (> 0).
     * @param _deliveryDeadline Absolute unix timestamp; must be after the funding deadline.
     * @param _challengeWindow Seconds backers have to object after each proof (1 to 30 days).
     * @param _milestoneBps Payout share per milestone in basis points; 1 to 10 entries, each > 0, summing to 10000.
     */
    constructor(
        address _merchant,
        address _platformFeeRecipient,
        uint16 _platformFeeBps,
        uint256 _softCap,
        uint256 _hardCap,
        uint256 _fundingDuration,
        uint256 _deliveryDeadline,
        uint256 _challengeWindow,
        uint16[] memory _milestoneBps
    ) {
        if (_merchant == address(0) || _platformFeeRecipient == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFee();
        if (_softCap == 0 || _hardCap < _softCap) revert InvalidCap();
        if (_fundingDuration == 0) revert InvalidDuration();
        uint256 _fundingDeadline = block.timestamp + _fundingDuration;
        if (_deliveryDeadline <= _fundingDeadline) revert InvalidDuration();
        if (_challengeWindow < MIN_CHALLENGE_WINDOW || _challengeWindow > MAX_CHALLENGE_WINDOW) {
            revert InvalidChallengeWindow();
        }

        uint256 count = _milestoneBps.length;
        if (count == 0 || count > MAX_MILESTONES) revert InvalidMilestones();
        uint256 totalBps;
        for (uint256 i = 0; i < count; i++) {
            if (_milestoneBps[i] == 0) revert InvalidMilestones();
            totalBps += _milestoneBps[i];
            Milestone storage m = milestones.push();
            m.payoutBps = _milestoneBps[i];
        }
        if (totalBps != BPS) revert InvalidMilestones();

        merchant = _merchant;
        platformFeeRecipient = _platformFeeRecipient;
        platformFeeBps = _platformFeeBps;
        softCap = _softCap;
        hardCap = _hardCap;
        fundingDeadline = _fundingDeadline;
        deliveryDeadline = _deliveryDeadline;
        challengeWindow = _challengeWindow;
    }

    /**
     * @notice Pledges native currency (XDC, POL, ETH) toward the pre-order.
     * The merchant cannot pledge, so it cannot vote on its own milestones from its own address.
     */
    function pledge() external payable inState(CampaignState.Funding) {
        if (block.timestamp >= fundingDeadline) revert FundingClosed();
        if (msg.value == 0) revert ZeroAmount();
        if (msg.sender == merchant) revert Unauthorized();
        uint256 newTotal = totalPledged + msg.value;
        if (newTotal > hardCap) revert HardCapExceeded();

        pledges[msg.sender] += msg.value;
        totalPledged = newTotal;
        emit PledgeReceived(msg.sender, msg.value, newTotal);

        if (newTotal == hardCap) _setState(CampaignState.Active);
    }

    /**
     * @notice Closes the funding round after the funding deadline. Callable by anyone.
     * Active if the soft cap was met, otherwise Failed with a full refund pool.
     */
    function finalizeFunding() external inState(CampaignState.Funding) {
        if (block.timestamp < fundingDeadline) revert FundingStillOpen();
        if (totalPledged >= softCap) {
            _setState(CampaignState.Active);
        } else {
            _fail();
        }
    }

    /**
     * @notice Merchant submits proof for the current milestone and opens its challenge window.
     */
    function submitMilestoneProof(
        uint256 milestoneIndex,
        string calldata proofUri,
        bytes32 proofHash
    ) external inState(CampaignState.Active) {
        if (msg.sender != merchant) revert Unauthorized();
        if (milestoneIndex != currentMilestone) revert InvalidMilestones();
        if (block.timestamp > deliveryDeadline) revert DeliveryDeadlinePassed();
        Milestone storage m = milestones[milestoneIndex];
        if (m.submitted) revert MilestoneAlreadySubmitted();

        uint64 endsAt = uint64(block.timestamp + challengeWindow);
        m.submitted = true;
        m.challengeEndsAt = endsAt;
        m.proofUri = proofUri;
        m.proofHash = proofHash;

        emit MilestoneSubmitted(milestoneIndex, proofUri, proofHash, endsAt);
    }

    /**
     * @notice Backer objects to the current milestone proof. Weighted by pledge, once per milestone.
     * If objection weight exceeds 50% of totalPledged, the campaign fails immediately.
     */
    function object(uint256 milestoneIndex) external inState(CampaignState.Active) {
        if (milestoneIndex != currentMilestone) revert InvalidMilestones();
        Milestone storage m = milestones[milestoneIndex];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (block.timestamp >= m.challengeEndsAt) revert ChallengeWindowClosed();
        uint256 weight = pledges[msg.sender];
        if (weight == 0) revert NotBacker();
        if (hasObjected[milestoneIndex][msg.sender]) revert AlreadyObjected();

        hasObjected[milestoneIndex][msg.sender] = true;
        m.objectionWeight += weight;
        emit MilestoneObjected(milestoneIndex, msg.sender, weight, m.objectionWeight);
        if (m.objectionWeight * 2 > totalPledged) _fail();
    }

    /**
     * @notice Credits the current milestone payout to merchant and fee recipient. Callable by anyone
     * once the challenge window has closed. Objection weight is necessarily <= 50% here, since a
     * majority objection fails the campaign. Funds move via withdraw().
     */
    function disburseMilestone(uint256 milestoneIndex) external inState(CampaignState.Active) {
        if (milestoneIndex != currentMilestone) revert InvalidMilestones();
        Milestone storage m = milestones[milestoneIndex];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (block.timestamp < m.challengeEndsAt) revert ChallengeWindowOpen();

        m.disbursed = true;
        uint256 next = milestoneIndex + 1;
        currentMilestone = next;

        // Last milestone takes the exact remainder so no rounding dust stays locked.
        uint256 gross = next == milestones.length
            ? totalPledged - totalDisbursed
            : (totalPledged * m.payoutBps) / BPS;
        uint256 fee = (gross * platformFeeBps) / BPS;
        uint256 merchantAmount = gross - fee;

        totalDisbursed += gross;
        withdrawable[merchant] += merchantAmount;
        if (fee > 0) withdrawable[platformFeeRecipient] += fee;

        emit MilestoneDisbursed(milestoneIndex, merchantAmount, fee);

        if (next == milestones.length) _setState(CampaignState.Completed);
    }

    /**
     * @notice Fails an abandoned campaign. Callable by anyone after the delivery deadline,
     * provided the current milestone has no submitted proof awaiting its challenge window.
     */
    function markFailed() external inState(CampaignState.Active) {
        if (block.timestamp <= deliveryDeadline) revert DeliveryDeadlineNotReached();
        if (milestones[currentMilestone].submitted) revert MilestonePending();
        _fail();
    }

    /**
     * @notice Backer claims a pro-rata share of the undisbursed pool after failure.
     * refund = pledge * remainingPoolAtFailure / totalPledged, claimable once.
     */
    function claimRefund() external nonReentrant inState(CampaignState.Failed) {
        uint256 pledged = pledges[msg.sender];
        if (pledged == 0) revert NothingToRefund();
        if (refundedAmounts[msg.sender] != 0) revert AlreadyRefunded();

        uint256 amount = (pledged * remainingPoolAtFailure) / totalPledged;
        if (amount == 0) revert NothingToRefund();

        refundedAmounts[msg.sender] = amount;
        totalRefunded += amount;
        emit RefundClaimed(msg.sender, amount);

        _send(msg.sender, amount);
    }

    /**
     * @notice Pulls funds credited to the caller by milestone disbursements.
     */
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0;
        emit Withdrawal(msg.sender, amount);

        _send(msg.sender, amount);
    }

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    /// @notice Refund a backer could claim right now (0 if not Failed or already claimed).
    function refundableAmount(address backer) external view returns (uint256) {
        if (state != CampaignState.Failed || refundedAmounts[backer] != 0 || totalPledged == 0) return 0;
        return (pledges[backer] * remainingPoolAtFailure) / totalPledged;
    }

    function _fail() private {
        remainingPoolAtFailure = totalPledged - totalDisbursed;
        _setState(CampaignState.Failed);
        emit CampaignFailed(remainingPoolAtFailure);
    }

    function _setState(CampaignState newState) private {
        state = newState;
        emit StateChanged(newState);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
