//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/NettingLib.sol";

/**
 * @title NettingLibTester
 * @notice Tester contract for Netting library
 */
contract NettingLibTester {
    NettingLib.Info public info;

    function getInfo() external view returns (NettingLib.Info memory) {
        return info;
    }

    function addCollateral(uint256 _productId, NettingLib.AddCollateralParams memory _params)
        external
        returns (int256, int256)
    {
        return NettingLib.addCollateral(info, _productId, _params);
    }

    function getRequiredTokenAmountsForHedge(
        int128[2] memory _amountsUnderlying,
        int256[2] memory _deltas,
        int256 _spotPrice
    ) external pure returns (NettingLib.CompleteParams memory) {
        return NettingLib.getRequiredTokenAmountsForHedge(_amountsUnderlying, _deltas, _spotPrice);
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
