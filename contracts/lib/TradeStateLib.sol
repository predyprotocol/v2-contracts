//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/IFeeLevel.sol";
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
        // locked liquidity in current tick
        uint128 lockedLiquidity;
        // Global feeLevel multiplied by liquidity
        uint128 feeLevelMultipliedLiquidityGlobal;
        // current fee level scaled by 1e6. e.g) 1 bps is 1e6.
        int24 currentFeeLevelIndex;
        // Global realized profit and loss
        int128 realizedPnLGlobal;
    }

    function update(
        TradeState storage _tradeState,
        int128 _lockedLiquidity,
        int128 _amountPerLevel,
        int128 _feeLevelMultipliedLiquidity
    ) internal {
        _tradeState.liquidityBefore = LiqMath.addDelta(
            _tradeState.liquidityBefore,
            _lockedLiquidity
        );
        _tradeState.liquidityDelta = LiqMath.addDelta(
            _tradeState.liquidityDelta,
            _amountPerLevel
        );
        _tradeState.feeLevelMultipliedLiquidityGlobal = LiqMath.addDelta(
            _tradeState.feeLevelMultipliedLiquidityGlobal,
            _feeLevelMultipliedLiquidity
        );
    }

    function getFeeLevelMultipliedByLiquidity(
        TradeState memory _tradeState,
        mapping(int24 => IFeeLevel.Info) storage self,
        int24 _lower,
        int24 _upper,
        int24 _currentFeeLevelIndex
    ) external view returns (uint128, uint128) {
        uint128 liquidityUpper = _tradeState.liquidityBefore;
        uint128 feeLevelMultipliedLiquidityUpper = _tradeState
            .feeLevelMultipliedLiquidityGlobal;
        uint128 liquidityDelta = _tradeState.liquidityDelta;

        if (_lower > _currentFeeLevelIndex) {
            return (0, 0);
        } else if (_upper < _currentFeeLevelIndex) {
            while (_upper < _currentFeeLevelIndex) {
                IFeeLevel.Info memory currentFeeLevel = self[
                    _currentFeeLevelIndex
                ];

                liquidityDelta = LiqMath.addDelta(
                    liquidityDelta,
                    -currentFeeLevel.liquidityNet
                );

                liquidityUpper = LiqMath.addDelta(
                    liquidityUpper,
                    -int128(liquidityDelta)
                );

                feeLevelMultipliedLiquidityUpper = LiqMath.addDelta(
                    feeLevelMultipliedLiquidityUpper,
                    -(int128(liquidityDelta) *
                        (1e10 +
                            (int128(2 * _currentFeeLevelIndex + 1) * 1e6) /
                            2)) / 1e10
                );

                _currentFeeLevelIndex -= 1;
            }
        } else {
            console.log(2, liquidityUpper, _tradeState.lockedLiquidity);
            liquidityUpper = LiqMath.addDelta(
                liquidityUpper,
                -int128(_tradeState.lockedLiquidity)
            );
            feeLevelMultipliedLiquidityUpper = LiqMath.addDelta(
                feeLevelMultipliedLiquidityUpper,
                -((int128(_tradeState.lockedLiquidity) *
                    (1e10 +
                        (int128(2 * _currentFeeLevelIndex + 1) * 1e6) /
                        2)) / 1e10)
            );
            _currentFeeLevelIndex -= 1;
        }

        uint128 liquidityLower = liquidityUpper;
        uint128 feeLevelMultipliedLiquidityLower = feeLevelMultipliedLiquidityUpper;

        while (_lower <= _currentFeeLevelIndex) {
            IFeeLevel.Info memory currentFeeLevel = self[_currentFeeLevelIndex];

            liquidityDelta = LiqMath.addDelta(
                liquidityDelta,
                -currentFeeLevel.liquidityNet
            );

            liquidityLower = LiqMath.addDelta(
                liquidityLower,
                -int128(liquidityDelta)
            );

            feeLevelMultipliedLiquidityLower = LiqMath.addDelta(
                feeLevelMultipliedLiquidityLower,
                -((int128(liquidityDelta) *
                    (1e10 +
                        (int128(2 * _currentFeeLevelIndex + 1) * 1e6) /
                        2)) / 1e10)
            );

            _currentFeeLevelIndex -= 1;
        }

        return (
            liquidityUpper - liquidityLower,
            feeLevelMultipliedLiquidityUpper - feeLevelMultipliedLiquidityLower
        );
    }

    /**
     * @notice Returns notional value of locked and unlocked liquidity.
     * @param _amount The amount of LP token
     */
    function calculateLockedAndUnlockedLiquidity(
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
            uint128 liqDelta,
            uint128 feeLevelMultipliedLiquidity
        )
    {
        if (_feeLevelLower > _currentFeeLevelIndex) {
            unlockedLiquidity = _amount;
        } else if (_feeLevelUpper < _currentFeeLevelIndex) {
            lockedLiquidity = _amount;
            feeLevelMultipliedLiquidity = ((lockedLiquidity *
                uint128(
                    1e10 + (int128(_feeLevelLower + _feeLevelUpper) * 1e6) / 2
                )) / 1e10);
        } else {
            (
                lockedLiquidity,
                feeLevelMultipliedLiquidity
            ) = calculateLockedLiquidity(
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
    function calculateLockedLiquidity(
        TradeState memory _tradeState,
        int24 _currentFeeLevelIndex,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _amount
    ) internal pure returns (uint128, uint128) {
        uint128 lockedInLevel = _tradeState.lockedLiquidity;
        uint128 liquidityDelta = _tradeState.liquidityDelta;

        uint128 lockedAmountInCurrentLevel = (_amount * lockedInLevel) /
            (uint24(_feeLevelUpper - _feeLevelLower) * liquidityDelta);

        uint128 lockedAmountBefore = (_amount *
            uint24(_currentFeeLevelIndex - _feeLevelLower)) /
            uint24(_feeLevelUpper - _feeLevelLower);

        return (
            lockedAmountBefore + lockedAmountInCurrentLevel,
            ((lockedAmountBefore *
                uint128(
                    1e10 +
                        (int128(_feeLevelLower + _currentFeeLevelIndex) * 1e6) /
                        2
                )) +
                (lockedAmountInCurrentLevel *
                    uint128(
                        1e10 + (int128(2 * _currentFeeLevelIndex + 1) * 1e6) / 2
                    ))) / 1e10
        );
    }
}
