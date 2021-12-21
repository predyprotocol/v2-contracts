//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/TradeStateLib.sol";

/**
 * @title TradeStateLibTester
 * @notice Tester contract for TradeState library
 */
contract TradeStateLibTester {
    function testCalculateNotionalLockedAndUnlockedLiquidity(
        TradeStateLib.TradeState memory _tradeState,
        int24 _currentFeeLevelIndex,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _amount
    )
        external
        pure
        returns (
            uint128,
            uint128,
            uint128
        )
    {
        return
            TradeStateLib.calculateNotionalLockedAndUnlockedLiquidity(
                _tradeState,
                _currentFeeLevelIndex,
                _feeLevelLower,
                _feeLevelUpper,
                _amount
            );
    }
}
