//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/NettingLib.sol";

/**
 * @title NettingLibTester
 * @notice Tester contract for Netting library
 */
contract NettingLibTester {
    NettingLib.Info public info;

    function getPoolInfo(uint256 _productId) external view returns (NettingLib.PoolInfo memory) {
        return info.pools[_productId];
    }

    function addCollateral(uint256 _productId, NettingLib.AddCollateralParams memory _params)
        external
        returns (int256, int256)
    {
        return NettingLib.addCollateral(info, _productId, _params);
    }

    function complete(NettingLib.CompleteParams memory _params) external {
        NettingLib.complete(info, _params);
    }

    function getRequiredCollateral(uint256 _productId, NettingLib.AddCollateralParams memory _params)
        external
        pure
        returns (int256)
    {
        return NettingLib.getRequiredCollateral(_productId, _params);
    }

    function calculateWeightedDelta(
        uint256 _productId,
        int128 _delta0,
        int128 _delta1
    ) external pure returns (int256) {
        return NettingLib.calculateWeightedDelta(_productId, _delta0, _delta1);
    }
}
