//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./LiqMath.sol";
import "hardhat/console.sol";

/**
 * @title TradeStateLib
 */
library TradeStateLib {
    struct TradeState {
        // The amount of liquidity in the current fee level
        uint128 liquidityDelta;
        // The amount of liquidity in fee levels below current
        uint128 liquidityBefore;
        // locked liquidity in the current fee level
        uint128 lockedInLevel;
        // current fee level scaled by 1e6. e.g) 1 bps is 1e6.
        int128 currentFeeLevel;
        // Global feeLevel multiplied by liquidity
        uint128 feeLevelMultipliedLiquidityGlobal;
    }

    function update(
        TradeState storage _tradeState,
        int128 _lockedLiquidity,
        int128 _amountPerLevel
    ) internal {
        _tradeState.liquidityBefore = LiqMath.addDelta(
            _tradeState.liquidityBefore,
            _lockedLiquidity
        );
        _tradeState.liquidityDelta = LiqMath.addDelta(
            _tradeState.liquidityDelta,
            _amountPerLevel
        );
    }

    /**
     * @notice Returns notional value of locked and unlocked liquidity.
     * @param _amount The amount of LP token
     */
    function calculateNotionalLockedAndUnlockedLiquidity(
        TradeState memory _tradeState,
        int24 _currentFeeLevelIndex,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _amount
    )
        internal
        pure
        returns (
            uint128 lockedLiquidity,
            uint128 unlockedLiquidity,
            uint128 liqDelta
        )
    {
        if (_feeLevelLower > _currentFeeLevelIndex) {
            unlockedLiquidity = _amount;
        } else if (_feeLevelUpper < _currentFeeLevelIndex) {
            lockedLiquidity = _amount;
        } else {
            lockedLiquidity = calculateNotionalLockedLiquidity(
                _tradeState,
                _currentFeeLevelIndex,
                _feeLevelLower,
                _feeLevelUpper,
                _amount
            );

            unlockedLiquidity = _amount - lockedLiquidity;

            liqDelta = _amount / uint24(_feeLevelUpper - _feeLevelLower);
        }
    }

    /**
     * @notice Returns notional value of locked liquidity.
     * @param _amount The amount of LP token
     */
    function calculateNotionalLockedLiquidity(
        TradeState memory _tradeState,
        int24 _currentFeeLevelIndex,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _amount
    ) internal pure returns (uint128) {
        uint128 lockedInLevel = _tradeState.lockedInLevel;
        uint128 liquidityDelta = _tradeState.liquidityDelta;

        uint128 lockedAmountInCurrentLevel = (_amount * lockedInLevel) /
            (uint24(_feeLevelUpper - _feeLevelLower) * liquidityDelta);

        uint128 lockedAmount = lockedAmountInCurrentLevel +
            (_amount * uint24(_currentFeeLevelIndex - _feeLevelLower)) /
            uint24(_feeLevelUpper - _feeLevelLower);

        return lockedAmount;
    }
}
