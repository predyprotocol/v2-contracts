//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "forge-std/Test.sol";

import "../../src/lib/NettingLib.sol";

/**
 * @title NettingLibTester
 * @notice Tester contract for Netting library
 */
contract NettingLibTest is Test {
    NettingLib.Info public info;

    function testGetInfo() external view returns (NettingLib.Info memory) {
        return info;
    }

    function testAddMargin(uint256 _productId, NettingLib.AddMarginParams memory _params)
        external
        returns (int256, int256)
    {
        return NettingLib.addMargin(info, _productId, _params);
    }

    function testGetRequiredTokenAmountsForHedge(
        uint256 _amountUnderlying,
        int256[2] memory _deltas,
        int256 _spotPrice
    ) external pure returns (NettingLib.CompleteParams memory) {
        return NettingLib.getRequiredTokenAmountsForHedge(_amountUnderlying, _deltas, _spotPrice);
    }

    function testComplete(NettingLib.CompleteParams memory _params) external {
        NettingLib.complete(info, _params);
    }

    function testGetRequiredMargin(uint256 _productId, NettingLib.AddMarginParams memory _params)
        external
        pure
        returns (int256)
    {
        return NettingLib.getRequiredMargin(_productId, _params);
    }

    function testCalculateWeightedDelta(
        uint256 _productId,
        int128 _delta0,
        int128 _delta1
    ) external pure returns (int256) {
        return NettingLib.calculateWeightedDelta(_productId, _delta0, _delta1);
    }
}
