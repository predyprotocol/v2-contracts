//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/NettingLib.sol";

/**
 * @title NettingLibTester
 * @notice Tester contract for Netting library
 */
contract NettingLibTester {
    NettingLib.Info public info;

    function getPoolInfo(uint256 _poolId) external view returns (NettingLib.PoolInfo memory) {
        return info.pools[_poolId];
    }

    function addCollateral(uint256 _poolId, NettingLib.AddCollateralParams memory _params)
        external
        returns (int128, int128)
    {
        return NettingLib.addCollateral(info, _poolId, _params);
    }

    function complete(NettingLib.CompleteParams memory _params) external {
        NettingLib.complete(info, _params);
    }

    function getRequiredCollateral(uint256 _poolId, NettingLib.AddCollateralParams memory _params)
        external
        pure
        returns (int128)
    {
        return NettingLib.getRequiredCollateral(_poolId, _params);
    }

    function calculateWeightedDelta(
        uint256 _poolId,
        int128 _delta0,
        int128 _delta1
    ) external pure returns (int128) {
        return NettingLib.calculateWeightedDelta(_poolId, _delta0, _delta1);
    }
}
