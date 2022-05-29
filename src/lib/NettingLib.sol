//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./Math.sol";

/**
 * @title NettingLib
 *
 * HedgePositionValue = ETH * S + AmountUSDC
 *
 * Normally, Amount Locked is equal to HedgePositionValue.
 * AMM adjusts the HedgePositionValue to be equal to the RequiredMargin
 * by adding or decreasing AmountUSDC.
 *
 *  --------------------------------------------------
 * |              Total Liquidity Amount              |
 * |     Amount Locked       |
 * |    ETH     | AmountUSDC |
 *  --------------------------------------------------
 *
 * If RequiredMargin becomes smaller than ETH value that AMM has, AmountUSDC becomes negative.
 *
 *  --------------------------------------------------
 * |              Total Liquidity Amount              |
 * |      Amount Locked(10)       |
 * |            ETH(15)                          |
 *                                |AmountUSDC(-5)|
 *  --------------------------------------------------
 *
 * After hedge completed, AmountUSDC becomes positive.
 *
 *  --------------------------------------------------
 * |              Total Liquidity Amount              |
 * |      Amount Locked(10)       |
 * |      ETH(6)    |
 *                  |AmountUSDC(4)|
 *  --------------------------------------------------
 *
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
    using SafeMath for int256;
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
        uint256 futureWeight;
        bool isLong;
    }

    struct Info {
        int256[2] amountsUsdc;
        uint256 amountUnderlying;
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

        hedgePositionValue = getHedgePositionValue(_info, _params, _productId);

        requiredMargin = totalRequiredMargin.sub(hedgePositionValue);

        _info.amountsUsdc[_productId] = _info.amountsUsdc[_productId].add(requiredMargin);
    }

    function getRequiredTokenAmountsForHedge(
        uint256 _amountUnderlying,
        int256[2] memory _deltas,
        int256 _spotPrice
    ) internal pure returns (CompleteParams memory completeParams) {
        int256 totalUnderlyingPosition = _amountUnderlying.toInt256();

        // 1. Calculate required amount of underlying token
        int256 requiredUnderlyingAmount;
        {
            // required amount is -(net delta)
            requiredUnderlyingAmount = -_deltas[0].add(_deltas[1]).add(totalUnderlyingPosition);

            if (_deltas[0].add(_deltas[1]) > 0) {
                // if pool delta is positive
                requiredUnderlyingAmount = -totalUnderlyingPosition;
            }

            completeParams.isLong = requiredUnderlyingAmount > 0;
        }

        // 2. Calculate USDC and ETH amounts.
        completeParams.amountUnderlying = Math.abs(requiredUnderlyingAmount);
        completeParams.amountUsdc = (Math.abs(requiredUnderlyingAmount).mul(uint256(_spotPrice))) / 1e8;

        completeParams.futureWeight = calculateWeight(0, _deltas[0], _deltas[1]);

        return completeParams;
    }

    /**
     * @notice Completes delta hedging procedure
     * Calculate holding amount of Underlying and USDC after a hedge.
     */
    function complete(Info storage _info, CompleteParams memory _params) internal {
        uint256 amountRequired0 = _params.amountUsdc.mul(_params.futureWeight).div(1e16);
        uint256 amountRequired1 = _params.amountUsdc.sub(amountRequired0);

        require(_params.amountUnderlying > 0, "N1");

        if (_params.isLong) {
            _info.amountUnderlying = _info.amountUnderlying.add(_params.amountUnderlying);

            _info.amountsUsdc[0] = _info.amountsUsdc[0].sub(amountRequired0.toInt256());
            _info.amountsUsdc[1] = _info.amountsUsdc[1].sub(amountRequired1.toInt256());
        } else {
            _info.amountUnderlying = _info.amountUnderlying.sub(_params.amountUnderlying);

            _info.amountsUsdc[0] = _info.amountsUsdc[0].add(amountRequired0.toInt256());
            _info.amountsUsdc[1] = _info.amountsUsdc[1].add(amountRequired1.toInt256());
        }
    }

    /**
     * @notice Gets required margin
     * @param _productId Id of product to get required margin
     * @param _params parameters to calculate required margin
     * @return RequiredMargin scaled by 1e8
     */
    function getRequiredMargin(uint256 _productId, AddMarginParams memory _params) internal pure returns (int256) {
        int256 weightedDelta = calculateWeightedDelta(_productId, _params.delta0, _params.delta1);
        int256 deltaFromGamma = 0;

        if (_productId == 1) {
            deltaFromGamma = _params.poolMarginRiskParam.mul(_params.spotPrice).mul(_params.gamma1).div(1e12);
        }

        int256 requiredMargin = (
            _params.spotPrice.mul(Math.abs(weightedDelta).add(Math.abs(deltaFromGamma)).toInt256())
        ).div(1e8);

        return ((1e4 + _params.poolMarginRiskParam).mul(requiredMargin)).div(1e4);
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue_i = AmountsUsdc_i+(|delta_i| / (Σ|delta_i|))*AmountUnderlying*S
     * @return HedgePositionValue scaled by 1e8
     */
    function getHedgePositionValue(
        Info memory _info,
        AddMarginParams memory _params,
        uint256 _productId
    ) internal pure returns (int256) {
        int256 totalHedgeNotional = _params.spotPrice.mul(_info.amountUnderlying.toInt256()).div(1e8);

        int256 productHedgeNotional = totalHedgeNotional
            .mul(calculateWeight(0, _params.delta0, _params.delta1).toInt256())
            .div(1e16);

        if (_productId == 1) {
            productHedgeNotional = totalHedgeNotional.sub(productHedgeNotional);
        }

        int256 hedgePositionValue = _info.amountsUsdc[_productId].add(productHedgeNotional);

        return hedgePositionValue;
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue_i = AmountsUsdc_0+AmountsUsdc_1+AmountUnderlying*S
     * @return HedgePositionValue scaled by 1e8
     */
    function getTotalHedgePositionValue(Info memory _info, int256 _spotPrice) internal pure returns (int256) {
        int256 hedgeNotional = _spotPrice.mul(_info.amountUnderlying.toInt256()).div(1e8);

        return (_info.amountsUsdc[0].add(_info.amountsUsdc[1])).add(hedgeNotional);
    }

    /**
     * @notice Calculates weighted delta
     * WeightedDelta = |delta_i| * (Σdelta_i) / (Σ|delta_i|)
     * @return weighted delta scaled by 1e8
     */
    function calculateWeightedDelta(
        uint256 _productId,
        int256 _delta0,
        int256 _delta1
    ) internal pure returns (int256) {
        int256 netDelta = _delta0.add(_delta1);

        return netDelta.mul(calculateWeight(_productId, _delta0, _delta1).toInt256()).div(1e16);
    }

    /**
     * @notice Calculates delta weighted value
     * WeightedDelta = |delta_i| / (Σ|delta_i|)
     * @return weighted delta scaled by 1e16
     */
    function calculateWeight(
        uint256 _productId,
        int256 _delta0,
        int256 _delta1
    ) internal pure returns (uint256) {
        uint256 totalDelta = (Math.abs(_delta0).add(Math.abs(_delta1)));

        require(totalDelta >= 0, "N1");

        if (totalDelta == 0) {
            return 0;
        }

        if (_productId == 0) {
            return (Math.abs(_delta0).mul(1e16)).div(totalDelta);
        } else if (_productId == 1) {
            return (Math.abs(_delta1).mul(1e16)).div(totalDelta);
        } else {
            revert("N0");
        }
    }
}
