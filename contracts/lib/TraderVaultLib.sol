//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./Math.sol";

/**
 * @title TraderVaultLib
 * Error codes
 * T0: PositionValue must be greater than MinCollateral
 * T1: PositionValue must be less than MinCollateral
 * T2: Vault is insolvent
 */
library TraderVaultLib {
    /// @dev risk parameter for MinCollateral calculation is 7.5%
    uint128 constant RISK_PARAM_FOR_VAULT = 750;

    /// @dev liquidation fee is 50%
    int128 constant LIQUIDATION_FEE = 5000;

    struct PoolParams {
        int128 markPrice0;
        int128 markPrice1;
        int128 cumFundingFeePerSizeGlobal0;
        int128 cumFundingFeePerSizeGlobal1;
    }

    struct TraderPosition {
        // position sizes
        int128[2] size;
        // entry price scaled by 1e16
        int128[2] entry;
        // cumulative funding fee entry
        int128[2] cumulativeFundingFeeEntry;
        // amount of USDC
        int128 usdcPosition;
        // insolvency flag
        bool isInsolvent;
    }

    /**
     * @notice Deposits or withdraw collateral
     * @param _targetMinCollateralPerPositionValueRatio target MinCollateral / PositionValue ratio.
     * @return finalDepositOrWithdrawAmount positive means required more collateral and negative means excess collateral.
     */
    function depositOrWithdraw(
        TraderPosition storage _traderPosition,
        int128 _targetMinCollateralPerPositionValueRatio,
        uint128 _spot,
        PoolParams memory _poolParams
    ) internal returns (int128 finalDepositOrWithdrawAmount) {
        require(!_traderPosition.isInsolvent, "T2");

        int128 positionValue = getPositionValue(_traderPosition, _poolParams);
        int128 minCollateral = getMinCollateral(_traderPosition, _spot);

        int128 requiredPositionValue = ((1e8 * minCollateral) / _targetMinCollateralPerPositionValueRatio);

        finalDepositOrWithdrawAmount = requiredPositionValue - positionValue;

        _traderPosition.usdcPosition += finalDepositOrWithdrawAmount;
    }

    /**
     * @notice Updates positions in a vault
     */
    function updatePosition(
        TraderPosition storage _traderPosition,
        uint256 _poolId,
        int128 _size,
        int128 _entry,
        int128 _cumulativeFundingFeeEntry
    ) internal {
        require(!_traderPosition.isInsolvent, "T2");

        _traderPosition.size[_poolId] += _size;
        _traderPosition.entry[_poolId] += _entry;
        _traderPosition.cumulativeFundingFeeEntry[_poolId] += _cumulativeFundingFeeEntry;
    }

    /**
     * @notice Checks PositionValue is greater than MinCollateral
     */
    function checkMinCollateral(
        TraderPosition storage traderPosition,
        uint128 _spot,
        PoolParams memory _poolParams
    ) internal pure {
        int128 positionValue = getPositionValue(traderPosition, _poolParams);

        require(positionValue >= getMinCollateral(traderPosition, _spot), "T0");
    }

    /**
     * @notice Liquidates a vault whose PositionValue is less than MinCollateral
     */
    function liquidate(
        TraderPosition storage _traderPosition,
        uint128 _spot,
        PoolParams memory _poolParams
    ) internal returns (uint128) {
        int128 positionValue = getPositionValue(_traderPosition, _poolParams);

        require(positionValue < getMinCollateral(_traderPosition, _spot), "T1");

        if (positionValue < 0) {
            _traderPosition.isInsolvent = true;
            positionValue = 0;
        }

        // clean positions
        _traderPosition.size[0] = 0;
        _traderPosition.size[1] = 0;
        _traderPosition.entry[0] = 0;
        _traderPosition.entry[1] = 0;

        int128 reward = (positionValue * LIQUIDATION_FEE) / 1e4;

        // reduce collateral
        _traderPosition.usdcPosition -= reward;

        return uint128(reward);
    }

    /**
     * @notice Gets min collateral
     * MinCollateral = 0.075 * S * (|2*S*a_{sqeeth}+a_{future}| + 0.15*S*|a_{sqeeth}|)
     * @return MinCollateral scaled by 1e6
     */
    function getMinCollateral(TraderPosition memory _traderPosition, uint128 _spot) internal pure returns (int128) {
        uint128 maxDelta = Math.abs((2 * int128(_spot) * _traderPosition.size[0]) / 1e12 + _traderPosition.size[1]) +
            (2 * RISK_PARAM_FOR_VAULT * _spot * Math.abs(_traderPosition.size[0] / 1e12)) /
            1e4;

        uint128 minCollateral = (RISK_PARAM_FOR_VAULT * _spot * maxDelta) / (1e4 * 1e8);

        return int128(minCollateral / 1e2);
    }

    /**
     * @notice Gets position value
     * PositionValue = Σ(Price_{i} * a_{i} - entry_{i}) + USDC + FundingFee
     * @return PositionValue scaled by 1e6
     */
    function getPositionValue(TraderPosition memory _traderPosition, PoolParams memory _poolParams)
        internal
        pure
        returns (int128)
    {
        int128 pnl = getSqeethAndFutureValue(_traderPosition, _poolParams);

        return
            pnl +
            _traderPosition.usdcPosition +
            getFundingFee(
                _traderPosition,
                _poolParams.cumFundingFeePerSizeGlobal0,
                _poolParams.cumFundingFeePerSizeGlobal1
            );
    }

    /**
     * @notice Gets Sqeeth and Future value
     * SqeethAndFutureValue = Σ(Price_{i} * a_{i} - entry_{i})
     * @return SqeethAndFutureValue scaled by 1e6
     */
    function getSqeethAndFutureValue(TraderPosition memory _traderPosition, PoolParams memory _poolParams)
        internal
        pure
        returns (int128)
    {
        int128 pnl = (_poolParams.markPrice0 *
            _traderPosition.size[0] -
            _traderPosition.entry[0] +
            _poolParams.markPrice1 *
            _traderPosition.size[1] -
            _traderPosition.entry[1]);

        return pnl / 1e10;
    }

    /**
     * @notice Gets funding fee
     * FundingFee = Σ(FundingEntry_i - a_i*cumFundingGlobal_i)
     * @return FundingFee scaled by 1e6
     */
    function getFundingFee(
        TraderPosition memory _traderPosition,
        int128 _cumFundingFeePerSizeGlobal0,
        int128 _cumFundingFeePerSizeGlobal1
    ) internal pure returns (int128) {
        int128 fundingFee = (_traderPosition.cumulativeFundingFeeEntry[0] -
            _cumFundingFeePerSizeGlobal0 *
            _traderPosition.size[0] +
            _traderPosition.cumulativeFundingFeeEntry[1] -
            _cumFundingFeePerSizeGlobal1 *
            _traderPosition.size[1]);

        return fundingFee / 1e10;
    }
}
