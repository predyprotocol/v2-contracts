//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./Math.sol";

/**
 * @title NettingLib
 * Error codes
 * N0: Unknown product id
 * N1: Total delta must be greater than 0
 * N2: No enough USDC
 */
library NettingLib {
    using SafeCast for int256;
    using SafeCast for uint128;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafeMath for uint128;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;

    struct AddMarginParams {
        int256 delta0;
        int256 delta1;
        int256 gamma1;
        int256 spotPrice;
        int256 poolMarginRiskParam;
    }

    struct CompleteParams {
        uint256 amountUsdc;
        uint256 amountUnderlying;
        int256[2] amountsRequiredUnderlying;
        bool isLong;
    }

    struct Info {
        uint128 amountAaveCollateral;
        uint128[2] amountsUsdc;
        int128[2] amountsUnderlying;
    }

    /**
     * @notice Adds required margin for delta hedging
     */
    function addMargin(
        Info storage _info,
        uint256 _productId,
        AddMarginParams memory _params
    ) internal returns (int256 requiredMargin, int256 hedgePositionValue) {
        int256 totalRequiredMargin = getRequiredMargin(_productId, _params);

        hedgePositionValue = getHedgePositionValue(_info, _params.spotPrice, _productId);

        requiredMargin = totalRequiredMargin.sub(hedgePositionValue);

        if (_info.amountsUsdc[_productId].toInt256().add(requiredMargin) < 0) {
            requiredMargin = -_info.amountsUsdc[_productId].toInt256();
        }

        _info.amountsUsdc[_productId] = _info
            .amountsUsdc[_productId]
            .toInt256()
            .add(requiredMargin)
            .toUint256()
            .toUint128();
    }

    function getRequiredTokenAmountsForHedge(
        int128[2] memory _amountsUnderlying,
        int256[2] memory _deltas,
        int256 _spotPrice
    ) internal pure returns (CompleteParams memory completeParams) {
        completeParams.amountsRequiredUnderlying[0] = -_amountsUnderlying[0] - _deltas[0];
        completeParams.amountsRequiredUnderlying[1] = -_amountsUnderlying[1] - _deltas[1];

        int256 totalUnderlyingPosition = getTotalUnderlyingPosition(_amountsUnderlying);

        // 1. Calculate required amount of underlying token
        int256 requiredUnderlyingAmount;
        {
            // required amount is -(net delta)
            requiredUnderlyingAmount = -_deltas[0].add(_deltas[1]).add(totalUnderlyingPosition);

            if (_deltas[0].add(_deltas[1]) > 0) {
                // if pool delta is positive
                requiredUnderlyingAmount = -totalUnderlyingPosition;

                completeParams.amountsRequiredUnderlying[1] = -_amountsUnderlying[1] + _deltas[0];
            }

            completeParams.isLong = requiredUnderlyingAmount > 0;
        }

        // 2. Calculate USDC and ETH amounts.
        completeParams.amountUnderlying = Math.abs(requiredUnderlyingAmount);
        completeParams.amountUsdc = (Math.abs(requiredUnderlyingAmount).mul(uint256(_spotPrice))) / 1e8;

        return completeParams;
    }

    /**
     * @notice Completes delta hedging procedure
     * Calculate holding amount of Underlying and USDC after a hedge.
     */
    function complete(Info storage _info, CompleteParams memory _params) internal {
        uint256 totalUnderlying = Math.abs(_params.amountsRequiredUnderlying[0]).add(
            Math.abs(_params.amountsRequiredUnderlying[1])
        );

        require(totalUnderlying > 0, "N1");

        for (uint256 i = 0; i < 2; i++) {
            _info.amountsUnderlying[i] = _info
                .amountsUnderlying[i]
                .add(_params.amountsRequiredUnderlying[i])
                .toInt128();

            {
                uint256 deltaUsdcAmount = (_params.amountUsdc.mul(Math.abs(_params.amountsRequiredUnderlying[i]))).div(
                    totalUnderlying
                );

                if (_params.isLong) {
                    require(_info.amountsUsdc[i] >= deltaUsdcAmount, "N2");
                    _info.amountsUsdc[i] = _info.amountsUsdc[i].sub(deltaUsdcAmount).toUint128();
                } else {
                    _info.amountsUsdc[i] = _info.amountsUsdc[i].add(deltaUsdcAmount).toUint128();
                }
            }
        }
    }

    /**
     * @notice Gets required margin
     * @param _productId Id of product to get required margin
     * @param _params parameters to calculate required margin
     * @return RequiredMargin scaled by 1e8
     */
    function getRequiredMargin(uint256 _productId, AddMarginParams memory _params) internal pure returns (int256) {
        if (_productId == 0) {
            return getRequiredMarginOfFuture(_params);
        } else if (_productId == 1) {
            return getRequiredMarginOfSqueeth(_params);
        } else {
            revert("N0");
        }
    }

    /**
     * @notice Gets required margin for future
     * RequiredMargin_{future} = (1+α)*S*WeightedDelta
     * @return RequiredMargin scaled by 1e8
     */
    function getRequiredMarginOfFuture(AddMarginParams memory _params) internal pure returns (int256) {
        int256 requiredMargin = (
            _params.spotPrice.mul(Math.abs(calculateWeightedDelta(0, _params.delta0, _params.delta1)).toInt256())
        ) / 1e8;
        return ((1e4 + _params.poolMarginRiskParam).mul(requiredMargin)) / 1e4;
    }

    /**
     * @notice Gets required margin for squeeth
     * RequiredMargin_{squeeth}
     * = max((1-α) * S * |WeightDelta_{sqeeth}-α * S * gamma|, (1+α) * S * |WeightDelta_{sqeeth}+α * S * gamma|)
     * @return RequiredMargin scaled by 1e8
     */
    function getRequiredMarginOfSqueeth(AddMarginParams memory _params) internal pure returns (int256) {
        int256 weightedDelta = calculateWeightedDelta(1, _params.delta0, _params.delta1);
        int256 deltaFromGamma = (_params.poolMarginRiskParam.mul(_params.spotPrice).mul(_params.gamma1)) / 1e12;

        return
            Math.max(
                (
                    (1e4 - _params.poolMarginRiskParam).mul(_params.spotPrice).mul(
                        Math.abs(weightedDelta.sub(deltaFromGamma)).toInt256()
                    )
                ) / 1e12,
                (
                    (1e4 + _params.poolMarginRiskParam).mul(_params.spotPrice).mul(
                        Math.abs(weightedDelta.add(deltaFromGamma)).toInt256()
                    )
                ) / 1e12
            );
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue_i = AmountsUsdc_i+AmountsUnderlying_i*S
     * @return HedgePositionValue scaled by 1e8
     */
    function getHedgePositionValue(
        Info memory _info,
        int256 _spot,
        uint256 _productId
    ) internal pure returns (int256) {
        int256 hedgeNotional = _spot.mul(_info.amountsUnderlying[_productId]) / 1e8;

        return _info.amountsUsdc[_productId].toInt256().add(hedgeNotional);
    }

    /**
     * @notice Gets total underlying position
     * TotalUnderlyingPosition = ΣAmountsUnderlying_i
     */
    function getTotalUnderlyingPosition(int128[2] memory _amountsUnderlying)
        internal
        pure
        returns (int256 underlyingPosition)
    {
        for (uint256 i = 0; i < 2; i++) {
            underlyingPosition = underlyingPosition.add(_amountsUnderlying[i]);
        }

        return underlyingPosition;
    }

    /**
     * @notice Calculates weighted delta
     * WeightedDelta = delta_i * (Σdelta_i) / (Σ|delta_i|)
     * @return weighted delta scaled by 1e8
     */
    function calculateWeightedDelta(
        uint256 _productId,
        int256 _delta0,
        int256 _delta1
    ) internal pure returns (int256) {
        int256 netDelta = _delta0.add(_delta1);
        int256 totalDelta = (Math.abs(_delta0).add(Math.abs(_delta1))).toInt256();

        require(totalDelta >= 0, "N1");

        if (totalDelta == 0) {
            return 0;
        }

        if (_productId == 0) {
            return (Math.abs(_delta0).toInt256().mul(netDelta)).div(totalDelta);
        } else if (_productId == 1) {
            return (Math.abs(_delta1).toInt256().mul(netDelta)).div(totalDelta);
        } else {
            revert("N0");
        }
    }
}
