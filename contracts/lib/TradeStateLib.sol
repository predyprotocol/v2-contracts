//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/IFeeLevel.sol";
import "./LiqMath.sol";
import "./FeeLevel.sol";
import "./FeeLevelMultipliedLiquidity.sol";
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

    // Cache data for TradeState
    struct TradeStateCache {
        uint128 liquidityDelta;
        uint128 liquidityBefore;
        uint128 lockedLiquidity;
        int128 currentFeeLevel;
        int24 currentFeeLevelIndex;
        int24 nextFeeLevelIndex;
        // Global feeLevel multiplied by liquidity
        uint128 feeLevelMultipliedLiquidityGlobal;
        int128 realizedPnLGlobal;
    }

    struct Result {
        uint128 lockedInLevel;
        uint128 liqDelta;
        uint128 levelMultiplied;
    }

    function update(
        TradeState storage _tradeState,
        int128 _lockedLiquidity,
        Result memory _result,
        bool _isDeposit
    ) external {
        _tradeState.liquidityBefore = LiqMath.addDelta(
            _tradeState.liquidityBefore,
            _lockedLiquidity
        );
        _tradeState.lockedLiquidity = LiqMath.addDelta(
            _tradeState.lockedLiquidity,
            _isDeposit
                ? int128(_result.lockedInLevel)
                : -int128(_result.lockedInLevel)
        );
        _tradeState.liquidityDelta = LiqMath.addDelta(
            _tradeState.liquidityDelta,
            _isDeposit ? int128(_result.liqDelta) : -int128(_result.liqDelta)
        );
        _tradeState.feeLevelMultipliedLiquidityGlobal = LiqMath.addDelta(
            _tradeState.feeLevelMultipliedLiquidityGlobal,
            _isDeposit
                ? int128(_result.levelMultiplied)
                : -int128(_result.levelMultiplied)
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
        uint128 liquidityLower;
        uint128 feeLevelMultipliedLiquidityLower;

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
                    -int128(
                        FeeLevelMultipliedLiquidity
                            .calFeeLevelMultipliedLiquidity(
                                liquidityDelta,
                                _currentFeeLevelIndex
                            )
                    )
                );

                _currentFeeLevelIndex -= 1;
            }

            liquidityLower = liquidityUpper;
            feeLevelMultipliedLiquidityLower = feeLevelMultipliedLiquidityUpper;
        } else {
            liquidityLower = liquidityUpper;
            feeLevelMultipliedLiquidityLower = feeLevelMultipliedLiquidityUpper;
            liquidityLower = LiqMath.addDelta(
                liquidityLower,
                -int128(_tradeState.lockedLiquidity)
            );
            feeLevelMultipliedLiquidityLower = LiqMath.addDelta(
                feeLevelMultipliedLiquidityLower,
                -int128(
                    FeeLevelMultipliedLiquidity.calFeeLevelMultipliedLiquidity(
                        _tradeState.lockedLiquidity,
                        _currentFeeLevelIndex
                    )
                )
            );
            _currentFeeLevelIndex -= 1;
        }

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
                -int128(
                    FeeLevelMultipliedLiquidity.calFeeLevelMultipliedLiquidity(
                        liquidityDelta,
                        _currentFeeLevelIndex
                    )
                )
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
        external
        pure
        returns (
            uint128 lockedLiquidity,
            uint128 unlockedLiquidity,
            Result memory result
        )
    {
        result = Result(0, 0, 0);

        if (_feeLevelLower > _currentFeeLevelIndex) {
            unlockedLiquidity = _amount;
        } else if (_feeLevelUpper < _currentFeeLevelIndex) {
            lockedLiquidity = _amount;
            result.levelMultiplied = ((lockedLiquidity *
                uint128(
                    1e10 + (int128(_feeLevelLower + _feeLevelUpper) * 1e6) / 2
                )) / 1e10);
        } else {
            (
                lockedLiquidity,
                result.lockedInLevel,
                result.levelMultiplied
            ) = calculateLockedLiquidity(
                _tradeState,
                _currentFeeLevelIndex,
                _feeLevelLower,
                _feeLevelUpper,
                _amount
            );

            unlockedLiquidity = _amount - lockedLiquidity;

            result.liqDelta = _amount / uint24(_feeLevelUpper - _feeLevelLower);
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
    )
        internal
        pure
        returns (
            uint128,
            uint128,
            uint128
        )
    {
        uint128 lockedAmountInCurrentLevel;
        {
            uint128 lockedInLevel = _tradeState.lockedLiquidity;
            uint128 liquidityDelta = _tradeState.liquidityDelta;
            lockedAmountInCurrentLevel =
                (_amount * lockedInLevel) /
                (uint24(_feeLevelUpper - _feeLevelLower) * liquidityDelta);
        }

        uint128 lockedAmountBefore = (_amount *
            uint24(_currentFeeLevelIndex - _feeLevelLower)) /
            uint24(_feeLevelUpper - _feeLevelLower);

        return (
            lockedAmountBefore + lockedAmountInCurrentLevel,
            lockedAmountInCurrentLevel,
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

    function transitionToNextTick(
        mapping(int24 => IFeeLevel.Info) storage _feeLevels,
        TradeStateCache memory _cache,
        bool _direction
    ) external returns (TradeStateCache memory) {
        if (_direction) {
            _cache.liquidityDelta = LiqMath.addDelta(
                _cache.liquidityDelta,
                -_feeLevels[_cache.currentFeeLevelIndex].liquidityNet
            );
        } else {
            _cache.liquidityDelta = LiqMath.addDelta(
                _cache.liquidityDelta,
                _feeLevels[_cache.nextFeeLevelIndex].liquidityNet
            );
        }

        FeeLevel.cross(
            _feeLevels,
            _cache.currentFeeLevelIndex,
            _cache.realizedPnLGlobal
        );

        _cache.lockedLiquidity = 0;
        _cache.currentFeeLevelIndex = _cache.nextFeeLevelIndex;

        _cache.currentFeeLevel = getCurrentFeeLevel(
            _cache.currentFeeLevelIndex,
            _cache.lockedLiquidity,
            _cache.liquidityDelta
        );

        if (_direction) {
            _cache.lockedLiquidity = _cache.liquidityDelta;
        }

        return _cache;
    }

    /**
     * @return current fee level scaled by 1e8
     */
    function getCurrentFeeLevel(
        int128 _currentFeeLevelIndex,
        uint128 _lockedLiquidity,
        uint128 _liquidityDelta
    ) public pure returns (int128) {
        int128 baseFeeLevel = int128(1e8) * _currentFeeLevelIndex;

        if (_liquidityDelta == 0) {
            return 0;
        }

        int128 fractionFeeLevel = int128(
            (1e8 * _lockedLiquidity) / _liquidityDelta
        );

        if (baseFeeLevel >= 0) {
            return baseFeeLevel + fractionFeeLevel;
        } else {
            return baseFeeLevel - fractionFeeLevel;
        }
    }
}
