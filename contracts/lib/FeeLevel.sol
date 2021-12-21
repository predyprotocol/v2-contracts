//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/IFeeLevel.sol";
import "./LiqMath.sol";
import "hardhat/console.sol";

/**
 * @title FeeLevel
 * @notice Functions to manage fee levels
 */
library FeeLevel {
    /**
     * @notice Calculate fee growth inside the range
     * @param _lower Lower fee level
     * @param _upper Upper fee level
     * @param _currentFeeLevel Current fee level
     * @param _globalRealizedPnL The global realized profit and loss
     */
    function getFeeGrowthInside(
        mapping(int24 => IFeeLevel.Info) storage self,
        int24 _lower,
        int24 _upper,
        int24 _currentFeeLevel,
        int128 _globalRealizedPnL
    ) internal view returns (int128) {
        IFeeLevel.Info memory lower = self[_lower];
        IFeeLevel.Info memory upper = self[_upper];

        if (_lower > _currentFeeLevel) {
            return lower.realizedPnLOutside - upper.realizedPnLOutside;
        } else if (_upper < _currentFeeLevel) {
            return upper.realizedPnLOutside - lower.realizedPnLOutside;
        } else {
            return
                _globalRealizedPnL -
                lower.realizedPnLOutside -
                upper.realizedPnLOutside;
        }
    }

    function getFeeLevelMultipliedByLiquidity(
        mapping(int24 => IFeeLevel.Info) storage self,
        int24 _lower,
        int24 _upper,
        int24 _currentFeeLevelIndex,
        uint128 _liquidityGlobal,
        uint128 _feeLevelMultipliedLiquidityGlobal
    ) external view returns (uint128, uint128) {
        uint128 liquidityUpper = _liquidityGlobal;
        uint128 feeLevelMultipliedLiquidityUpper = _feeLevelMultipliedLiquidityGlobal;

        if (_lower > _currentFeeLevelIndex) {
            return (0, 0);
        } else if (_upper < _currentFeeLevelIndex) {
            while (_upper <= _currentFeeLevelIndex) {
                IFeeLevel.Info memory currentFeeLevel = self[
                    _currentFeeLevelIndex
                ];

                liquidityUpper = LiqMath.addDelta(
                    liquidityUpper,
                    -currentFeeLevel.liquidityNet
                );

                feeLevelMultipliedLiquidityUpper = LiqMath.addDelta(
                    feeLevelMultipliedLiquidityUpper,
                    -(currentFeeLevel.liquidityNet *
                        (1e10 + int128(_currentFeeLevelIndex) / 2)) / 1e10
                );

                _currentFeeLevelIndex -= 1;
            }
        }

        uint128 liquidityLower = liquidityUpper;
        uint128 feeLevelMultipliedLiquidityLower = feeLevelMultipliedLiquidityUpper;

        while (_lower <= _currentFeeLevelIndex) {
            IFeeLevel.Info memory currentFeeLevel = self[_currentFeeLevelIndex];

            liquidityLower = LiqMath.addDelta(
                liquidityLower,
                -currentFeeLevel.liquidityNet
            );

            feeLevelMultipliedLiquidityLower = LiqMath.addDelta(
                feeLevelMultipliedLiquidityLower,
                -((currentFeeLevel.liquidityNet *
                    (1e10 + int128(_currentFeeLevelIndex) / 2)) / 1e10)
            );

            _currentFeeLevelIndex -= 1;
        }

        return (
            liquidityUpper - liquidityLower,
            feeLevelMultipliedLiquidityUpper - feeLevelMultipliedLiquidityLower
        );
    }

    /**
     * @notice Update a fee level
     * @param _levels The mapping of fee levels
     * @param _feeLevel The target feeLevel to update
     * @param _liquidityDelta A new amount of liquidity to be added or substracted when tick crosses
     */
    function update(
        mapping(int24 => IFeeLevel.Info) storage _levels,
        int24 _feeLevel,
        int128 _liquidityDelta
    ) internal {
        IFeeLevel.Info storage info = _levels[_feeLevel];

        if (_liquidityDelta > 0) {
            //info.liquidityGross += uint128(_liquidityDelta);
        } else {
            //info.liquidityGross -= uint128(-_liquidityDelta);
        }

        info.liquidityNet += _liquidityDelta;
    }

    /**
     * @notice Transition to the next fee level
     * @param _levels The mapping of fee levels
     * @param _feeLevel Source feeLevel of the transition
     * @param _globalRealizedPnL The global realized profit and loss
     */
    function cross(
        mapping(int24 => IFeeLevel.Info) storage _levels,
        int24 _feeLevel,
        int128 _globalRealizedPnL
    ) internal {
        IFeeLevel.Info storage info = _levels[_feeLevel];

        info.realizedPnLOutside = _globalRealizedPnL - info.realizedPnLOutside;
    }
}
