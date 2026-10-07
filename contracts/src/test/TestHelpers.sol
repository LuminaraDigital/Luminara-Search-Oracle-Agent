// SPDX-License-Identifier: MIT
// solhint-disable one-contract-per-file, avoid-low-level-calls
pragma solidity ^0.8.24;

/// @dev Test-only. Forwards arbitrary calls and attempts one reentrant call when it receives native currency.
contract ReentrantAttacker {
    address public reentryTarget;
    bytes public reentryData;
    uint256 public reentryAttempts;
    bool public lastReentrySucceeded;
    bytes public lastReentryReturn;

    function setReentry(address _target, bytes calldata data) external {
        reentryTarget = _target;
        reentryData = data;
    }

    function execute(address to, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        if (reentryData.length > 0 && reentryAttempts == 0) {
            reentryAttempts++;
            (bool ok, bytes memory ret) = reentryTarget.call(reentryData);
            lastReentrySucceeded = ok;
            lastReentryReturn = ret;
        }
    }
}

/// @dev Test-only. Rejects every incoming native transfer; can still make outbound calls.
contract RevertingReceiver {
    function execute(address to, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        revert("RevertingReceiver: no thanks");
    }
}
