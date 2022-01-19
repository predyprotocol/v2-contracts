//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./Math.sol";
import "./Pricer.sol";

/**
 * @title NettingLib
 * Error codes
 * N0: unknown pool id
 * N1: Total delta must be greater than 0
 * N2: Total delta must not be 0
 */
library NettingLib {
    /// @dev 40%
    int128 constant ALPHA = 4000;

    struct AddCollateralParams {
        int128 delta0;
        int128 delta1;
        int128 gamma0;
        uint128 spot;
    }

    struct CompleteParams {
        int128 usdcAmount;
        int128 underlyingAmount;
        int128[2] deltas;
        uint128 spot;
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
        uint256 _poolId,
        AddCollateralParams memory _params
    ) internal returns (int128 requiredCollateral, int128 hedgePositionValue) {
        int128 totalRequiredCollateral = getRequiredCollateral(_poolId, _params);

        hedgePositionValue = getHedgePositionValue(_info.pools[_poolId], _params.spot);

        requiredCollateral = totalRequiredCollateral - hedgePositionValue;

        _info.pools[_poolId].usdcPosition += requiredCollateral;
    }

    /**
     * @notice Completes delta hedging procedure
     * and calculate entry price of hedge position
     */
    function complete(Info storage _info, CompleteParams memory _params) internal {
        int128 netDelta = _params.deltas[0] + _params.deltas[1];
        int128 totalDelta = int128(Math.abs(_params.deltas[0]) + Math.abs(_params.deltas[1]));

        require(totalDelta > 0, "N2");

        _info.underlyingPosition += netDelta;

        for (uint256 i = 0; i < 2; i++) {
            _info.pools[i].usdcPosition -= (_params.usdcAmount * _params.deltas[i]) / totalDelta;

            _info.pools[i].underlyingPosition = -_params.deltas[i];

            // entry += uPos * S - (usdc/underlying)*(|uPos||netDelta|/|totalDelta|)
            int128 newEntry = (_info.pools[i].underlyingPosition * int128(_params.spot)) / 1e8;

            newEntry -=
                (_params.usdcAmount * int128(Math.abs(_info.pools[i].underlyingPosition) * Math.abs(netDelta))) /
                (_params.underlyingAmount * totalDelta);

            _info.pools[i].entry += newEntry;
        }
    }

    /**
     * @notice Gets required collateral for future
     * @param _poolId ID of pool to get required collateral
     * @param _params parameters to calculate required collateral
     * @return RequiredCollateral scaled by 1e8
     */
    function getRequiredCollateral(uint256 _poolId, AddCollateralParams memory _params) internal pure returns (int128) {
        if (_poolId == 0) {
            return getRequiredCollateralOfSqeeth(_params);
        } else if (_poolId == 1) {
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
        int128 requiredCollateral = (int128(_params.spot) *
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
        int128 deltaFromGamma = (ALPHA * int128(_params.spot) * _params.gamma0) / 1e12;

        return
            Math.max(
                ((1e4 - ALPHA) * int128(Math.abs(weightedDelta - deltaFromGamma))) / 1e4,
                ((1e4 + ALPHA) * int128(Math.abs(weightedDelta + deltaFromGamma))) / 1e4
            );
    }

    /**
     * @notice Gets notional value of hedge positions
     * HedgePositionValue = USDCPosition+UnderlyingPosition*S-entry
     * @return HedgePositionValue scaled by 1e8
     */
    function getHedgePositionValue(PoolInfo storage _poolState, uint128 _spot) internal view returns (int128) {
        int128 hedgeNotional = _poolState.usdcPosition +
            (int128(_spot) * _poolState.underlyingPosition) /
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
        uint256 _poolId,
        int128 _delta0,
        int128 _delta1
    ) internal pure returns (int128) {
        int128 netDelta = _delta0 + _delta1;
        int128 totalDelta = int128(Math.abs(_delta0) + Math.abs(_delta1));

        require(totalDelta >= 0, "N1");

        if (totalDelta == 0) {
            return 0;
        }

        if (_poolId == 0) {
            return (int128(Math.abs(_delta0)) * netDelta) / totalDelta;
        } else if (_poolId == 1) {
            return (int128(Math.abs(_delta1)) * netDelta) / totalDelta;
        } else {
            revert("N0");
        }
    }
}
