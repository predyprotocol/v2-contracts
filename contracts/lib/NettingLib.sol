//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./Math.sol";
import "./Pricer.sol";

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

    /// @dev 40%
    int128 private constant ALPHA = 4000;

    struct AddCollateralParams {
        int128 delta0;
        int128 delta1;
        int128 gamma0;
        int128 spotPrice;
    }

    struct CompleteParams {
        uint128 usdcAmount;
        uint128 underlyingAmount;
        int128[2] deltas;
        int128 spotPrice;
        bool isLong;
    }

    struct Info {
        int128 underlyingPosition;
        int128 aaveCollateral;
        int128 usdcBuffer;
        PoolInfo[2] pools;
    }

    struct PoolInfo {
        int128 usdcPosition;
        int128 underlyingPosition;
        int128 entry;
    }

    /**
     * @notice Adds required collaterals for delta hedging
     */
    function addCollateral(
        Info storage _info,
        uint256 _productId,
        AddCollateralParams memory _params
    ) internal returns (int128 requiredCollateral, int128 hedgePositionValue) {
        int128 totalRequiredCollateral = getRequiredCollateral(_productId, _params);

        hedgePositionValue = getHedgePositionValue(_info.pools[_productId], _params.spotPrice);

        requiredCollateral = totalRequiredCollateral - hedgePositionValue;

        if (_info.pools[_productId].usdcPosition + requiredCollateral < 0) {
            requiredCollateral = -_info.pools[_productId].usdcPosition;
        }

        _info.pools[_productId].usdcPosition += requiredCollateral;
    }

    /**
     * @notice Completes delta hedging procedure
     * and calculate entry price of hedge position
     */
    function complete(Info storage _info, CompleteParams memory _params) internal {
        int128 netDelta = _params.deltas[0] + _params.deltas[1];
        uint128 totalDelta = Math.abs(_params.deltas[0]) + Math.abs(_params.deltas[1]);

        require(totalDelta > 0, "N2");
        require(netDelta <= 0, "N3");

        _info.underlyingPosition = -netDelta;

        for (uint256 i = 0; i < 2; i++) {
            {
                uint128 deltaUsdcAmount = (_params.usdcAmount * Math.abs(_params.deltas[i])) / totalDelta;
                if (_params.isLong) {
                    _info.pools[i].usdcPosition -= int128(deltaUsdcAmount);
                } else {
                    _info.pools[i].usdcPosition += int128(deltaUsdcAmount);
                }
            }

            _info.pools[i].underlyingPosition = -_params.deltas[i];

            // entry += uPos * S - (usdc/underlying)*(|uPos|*|netDelta|/|totalDelta|)
            int128 newEntry = (_info.pools[i].underlyingPosition * _params.spotPrice) / 1e8;

            newEntry -= ((_params.usdcAmount * (Math.abs(_info.pools[i].underlyingPosition) * Math.abs(netDelta))) /
                (_params.underlyingAmount * totalDelta)).toInt256().toInt128();

            _info.pools[i].entry += newEntry;
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
        returns (int128)
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
    function getRequiredCollateralOfFuture(AddCollateralParams memory _params) internal pure returns (int128) {
        int128 requiredCollateral = (int128(_params.spotPrice) *
            int128(Math.abs(calculateWeightedDelta(1, _params.delta0, _params.delta1)))) / 1e8;
        return ((1e4 + ALPHA) * requiredCollateral) / 1e4;
    }

    /**
     * @notice Gets required collateral for sqeeth
     * RequiredCollateral_{sqeeth}
     * = max((1-\alpha) * S * |WeightDelta_{sqeeth}-\alpha * S * gamma|, (1+\alpha) * S * |WeightDelta_{sqeeth}+\alpha * S * gamma|)
     * @return RequiredCollateral scaled by 1e8
     */
    function getRequiredCollateralOfSqeeth(AddCollateralParams memory _params) internal pure returns (int128) {
        int128 weightedDelta = calculateWeightedDelta(0, _params.delta0, _params.delta1);
        int128 deltaFromGamma = (ALPHA * int128(_params.spotPrice) * _params.gamma0) / 1e12;

        return
            Math.max(
                ((1e4 - ALPHA) * _params.spotPrice * (Math.abs(weightedDelta - deltaFromGamma).toInt256().toInt128())) /
                    1e12,
                ((1e4 + ALPHA) * _params.spotPrice * (Math.abs(weightedDelta + deltaFromGamma).toInt256().toInt128())) /
                    1e12
            );
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue = USDCPosition+UnderlyingPosition*S-entry
     * @return HedgePositionValue scaled by 1e8
     */
    function getHedgePositionValue(PoolInfo storage _poolState, int128 _spot) internal view returns (int128) {
        int128 hedgeNotional = _poolState.usdcPosition +
            (_spot * _poolState.underlyingPosition) /
            1e8 -
            _poolState.entry;
        return hedgeNotional;
    }

    /**
     * @notice Calculates weighted delta
     * WeightedDelta = delta_i * (Σdelta_i) / (Σ|delta_i|)
     * @return weighted delta scaled by 1e8
     */
    function calculateWeightedDelta(
        uint256 _productId,
        int128 _delta0,
        int128 _delta1
    ) internal pure returns (int128) {
        int128 netDelta = _delta0 + _delta1;
        int128 totalDelta = (Math.abs(_delta0) + Math.abs(_delta1)).toInt256().toInt128();

        require(totalDelta >= 0, "N1");

        if (totalDelta == 0) {
            return 0;
        }

        if (_productId == 0) {
            return (int128(Math.abs(_delta0)) * netDelta) / totalDelta;
        } else if (_productId == 1) {
            return (int128(Math.abs(_delta1)) * netDelta) / totalDelta;
        } else {
            revert("N0");
        }
    }
}
