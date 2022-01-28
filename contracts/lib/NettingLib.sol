//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./Math.sol";

/**
 * @title NettingLib
 * Error codes
 * N0: unknown product id
 * N1: Total delta must be greater than 0
 * N2: Total delta must not be 0
 * N3: Net delta must be negative
 */
library NettingLib {
    using SafeCast for int256;
    using SafeCast for uint128;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;

    /// @dev 40%
    int128 private constant ALPHA = 4000;

    struct AddCollateralParams {
        int256 delta0;
        int256 delta1;
        int256 gamma0;
        int256 spotPrice;
    }

    struct CompleteParams {
        uint256 amountUsdc;
        uint256 amountUnderlying;
        int256[2] deltas;
        int256 spotPrice;
        bool isLong;
    }

    struct Info {
        int128 amountUnderlying;
        int128 amountAaveCollateral;
        PoolInfo[2] pools;
    }

    struct PoolInfo {
        int128 amountUsdc;
        int128 amountUnderlying;
        int128 valueEntry;
    }

    /**
     * @notice Adds required collaterals for delta hedging
     */
    function addCollateral(
        Info storage _info,
        uint256 _productId,
        AddCollateralParams memory _params
    ) internal returns (int256 requiredCollateral, int256 hedgePositionValue) {
        int256 totalRequiredCollateral = getRequiredCollateral(_productId, _params);

        hedgePositionValue = getHedgePositionValue(_info.pools[_productId], _params.spotPrice);

        requiredCollateral = totalRequiredCollateral.sub(hedgePositionValue);

        if (_info.pools[_productId].amountUsdc + requiredCollateral < 0) {
            requiredCollateral = -_info.pools[_productId].amountUsdc;
        }

        _info.pools[_productId].amountUsdc = _info.pools[_productId].amountUsdc.add(requiredCollateral).toInt128();
    }

    /**
     * @notice Completes delta hedging procedure
     * and calculate entry price of hedge position
     */
    function complete(Info storage _info, CompleteParams memory _params) internal {
        int256 netDelta = _params.deltas[0] + _params.deltas[1];
        uint256 totalDelta = Math.abs(_params.deltas[0]).add(Math.abs(_params.deltas[1]));

        require(totalDelta > 0, "N2");
        require(netDelta <= 0, "N3");

        _info.amountUnderlying = -netDelta.toInt128();

        for (uint256 i = 0; i < 2; i++) {
            {
                uint256 deltaUsdcAmount = (_params.amountUsdc.mul(Math.abs(_params.deltas[i]))).div(totalDelta);
                if (_params.isLong) {
                    _info.pools[i].amountUsdc = _info.pools[i].amountUsdc.sub(deltaUsdcAmount.toInt256()).toInt128();
                } else {
                    _info.pools[i].amountUsdc = _info.pools[i].amountUsdc.add(deltaUsdcAmount.toInt256()).toInt128();
                }
            }

            _info.pools[i].amountUnderlying = -(_params.deltas[i]).toInt128();

            // entry += uPos * S - (usdc/underlying)*(|uPos|*|netDelta|/|totalDelta|)
            int256 newEntry = _info.pools[i].amountUnderlying.mul(_params.spotPrice) / 1e8;

            newEntry = newEntry
                .sub(
                    ((_params.amountUsdc.mul(Math.abs(_info.pools[i].amountUnderlying).mul(Math.abs(netDelta)))) /
                        (_params.amountUnderlying.mul(totalDelta))).toInt256()
                )
                .toInt128();

            _info.pools[i].valueEntry = _info.pools[i].valueEntry.add(newEntry).toInt128();
        }
    }

    /**
     * @notice Gets required collateral for future
     * @param _productId Id of product to get required collateral
     * @param _params parameters to calculate required collateral
     * @return RequiredCollateral scaled by 1e8
     */
    function getRequiredCollateral(uint256 _productId, AddCollateralParams memory _params)
        internal
        pure
        returns (int256)
    {
        if (_productId == 0) {
            return getRequiredCollateralOfSqeeth(_params);
        } else if (_productId == 1) {
            return getRequiredCollateralOfFuture(_params);
        } else {
            revert("N0");
        }
    }

    /**
     * @notice Gets required collateral for future
     * RequiredCollateral_{future} = (1+α)*S*WeightedDelta
     * @return RequiredCollateral scaled by 1e8
     */
    function getRequiredCollateralOfFuture(AddCollateralParams memory _params) internal pure returns (int256) {
        int256 requiredCollateral = (
            _params.spotPrice.mul(Math.abs(calculateWeightedDelta(1, _params.delta0, _params.delta1)).toInt256())
        ) / 1e8;
        return ((1e4 + ALPHA).mul(requiredCollateral)) / 1e4;
    }

    /**
     * @notice Gets required collateral for sqeeth
     * RequiredCollateral_{sqeeth}
     * = max((1-\alpha) * S * |WeightDelta_{sqeeth}-\alpha * S * gamma|, (1+\alpha) * S * |WeightDelta_{sqeeth}+\alpha * S * gamma|)
     * @return RequiredCollateral scaled by 1e8
     */
    function getRequiredCollateralOfSqeeth(AddCollateralParams memory _params) internal pure returns (int256) {
        int256 weightedDelta = calculateWeightedDelta(0, _params.delta0, _params.delta1);
        int256 deltaFromGamma = (ALPHA.mul(_params.spotPrice).mul(_params.gamma0)) / 1e12;

        return
            Math.max(
                ((1e4 - ALPHA).mul(_params.spotPrice).mul(Math.abs(weightedDelta.sub(deltaFromGamma)).toInt256())) /
                    1e12,
                ((1e4 + ALPHA).mul(_params.spotPrice).mul(Math.abs(weightedDelta.add(deltaFromGamma)).toInt256())) /
                    1e12
            );
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue = USDCPosition+UnderlyingPosition*S-entry
     * @return HedgePositionValue scaled by 1e8
     */
    function getHedgePositionValue(PoolInfo storage _poolState, int256 _spot) internal view returns (int256) {
        int256 hedgeNotional = _poolState.amountUsdc.add(_spot.mul(_poolState.amountUnderlying) / 1e8).sub(
            _poolState.valueEntry
        );

        return hedgeNotional;
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
