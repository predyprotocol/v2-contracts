//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/Hedging.sol";

/**
 * @title HedgingTester
 * @notice Tester contract for Hedging library
 */
contract HedgingTester {
    Hedging.Info public info;

    function testAddPosition(
        uint256 _poolId,
        int128 _newDelta,
        int128 _requiredCollateral,
        uint128 _spot
    ) external {
        Hedging.addPosition(
            info,
            _poolId,
            _newDelta,
            _requiredCollateral,
            _spot
        );
    }

    function testComplete(int128 _netDelta, uint128 _spot) external {
        Hedging.complete(info, _netDelta, _spot);
    }

    function getEntry(uint256 _poolId, uint128 _spot)
        external
        view
        returns (int128)
    {
        return Hedging.getEntry(info.pools[_poolId], _spot);
    }
}
