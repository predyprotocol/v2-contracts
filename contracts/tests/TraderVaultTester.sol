//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/TraderVault.sol";

/**
 * @title TraderVaultTester
 * @notice Tester contract for TraderVault library
 */
contract TraderVaultTester {
    TraderVault.TraderPosition public traderPosition;
    int128 public r;

    function testSet(
        int128 _s0,
        int128 _s1,
        int128 _e0,
        int128 _e1,
        int128 _usdcPosition
    ) external {
        traderPosition.size[0] = _s0;
        traderPosition.size[1] = _s1;
        traderPosition.entry[0] = _e0;
        traderPosition.entry[1] = _e1;
        traderPosition.usdcPosition = _usdcPosition;
    }

    function testCheckIM(
        int128 _targetIMPerCollateral,
        int128 _martPrice0,
        int128 _markPrice1
    ) external {
        r = TraderVault.checkIM(
            traderPosition,
            _targetIMPerCollateral,
            _martPrice0,
            _markPrice1
        );
    }
}
