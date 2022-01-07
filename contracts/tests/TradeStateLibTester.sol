//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/TradeStateLib.sol";
import "../lib/FeeLevel.sol";

/**
 * @title TradeStateLibTester
 * @notice Tester contract for TradeState library
 */
contract TradeStateLibTester {
    using FeeLevel for mapping(int24 => IFeeLevel.Info);
    using FeeLevel for IFeeLevel.Info;

    mapping(int24 => IFeeLevel.Info) levels;

    function testSetFeeLevel(int24 _feeLevel, int128 _liquidityDelta) external {
        levels.update(_feeLevel, _liquidityDelta);
    }

    function testCalculateLockedAndUnlockedLiquidity(
        TradeStateLib.TradeState memory _tradeState,
        int24 _currentFeeLevelIndex,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _amount
    )
        external
        view
        returns (
            uint128,
            uint128,
            TradeStateLib.Result memory
        )
    {
        return
            TradeStateLib.calculateLockedAndUnlockedLiquidity(
                _tradeState,
                _currentFeeLevelIndex,
                _feeLevelLower,
                _feeLevelUpper,
                _amount
            );
    }

    function testGetFeeLevelMultipliedByLiquidity(
        TradeStateLib.TradeState memory _tradeState,
        int24 _lower,
        int24 _upper,
        int24 _currentFeeLevelIndex
    ) external view returns (uint128, uint128) {
        return
            TradeStateLib.getFeeLevelMultipliedByLiquidity(_tradeState, levels, _lower, _upper, _currentFeeLevelIndex);
    }
}
