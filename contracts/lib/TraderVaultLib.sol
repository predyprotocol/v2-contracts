//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IPerpetualMarketCore.sol";
import "./Math.sol";

/**
 * @title TraderVaultLib
 * Error codes
 * T0: PositionValue must be greater than MinCollateral
 * T1: PositionValue must be less than MinCollateral
 * T2: Vault is insolvent
 */
library TraderVaultLib {
    using SafeCast for int256;
    using SafeCast for uint128;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev risk parameter for MinCollateral calculation is 7.5%
    uint128 private constant RISK_PARAM_FOR_VAULT = 750;

    /// @dev liquidation fee is 50%
    int128 private constant LIQUIDATION_FEE = 5000;

    struct TraderPosition {
        int128[2] amountAsset;
        int128 amountUsdc;
        int128[2] valueEntry;
        int128[2] valueFundingFeeEntry;
        bool isInsolvent;
    }

    /**
     * @notice get amount of deposit required to add amount of Squees/Future
     * @param _ratio target MinCollateral / PositionValue ratio.
     * @return amount positive means required more collateral and negative means excess collateral.
     */
    function getAmountRequired(
        TraderPosition storage _traderPosition,
        int128 _ratio,
        IPerpetualMarketCore.PoolState memory _poolParams
    ) internal view returns (int128 amount) {
        require(!_traderPosition.isInsolvent, "T2");

        int128 positionValue = getPositionValue(_traderPosition, _poolParams);
        int128 minCollateral = getMinCollateral(_traderPosition, _poolParams.spotPrice);

        int128 requiredPositionValue = ((1e8 * minCollateral) / _ratio);

        amount = requiredPositionValue - positionValue;
    }

    /**
     * @notice update USDC amount
     * @param _amount amount to add. if positive then increase amount, if negative then decrease amount.
     */
    function updateUsdcAmount(TraderPosition storage _traderPosition, int128 _amount) internal {
        _traderPosition.amountUsdc += _amount;
    }

    /**
     * @notice update positions in a vault
     * @param _amountAsset position size to increase or decrease
     * @param _valueEntry entry value to increase or decrease
     * @param _valueFundingFeeEntry entry value of funding fee
     */
    function updateVault(
        TraderPosition storage _traderPosition,
        uint256 _productId,
        int128 _amountAsset,
        int128 _valueEntry,
        int128 _valueFundingFeeEntry
    ) internal {
        require(!_traderPosition.isInsolvent, "T2");

        _traderPosition.amountAsset[_productId] += _amountAsset;
        _traderPosition.valueEntry[_productId] += _valueEntry;
        _traderPosition.valueFundingFeeEntry[_productId] += _valueFundingFeeEntry;
    }

    /**
     * @notice liquidate a vault whose PositionValue is less than MinCollateral
     */
    function liquidate(TraderPosition storage _traderPosition, IPerpetualMarketCore.PoolState memory _poolParams)
        internal
        returns (uint128)
    {
        int128 positionValue = getPositionValue(_traderPosition, _poolParams);

        require(positionValue < getMinCollateral(_traderPosition, _poolParams.spotPrice), "T1");

        if (positionValue < 0) {
            _traderPosition.isInsolvent = true;
            positionValue = 0;
        }

        // clean positions
        for (uint128 i = 0; i < MAX_PRODUCT_ID; i++) {
            _traderPosition.amountAsset[i] = 0;
            _traderPosition.valueEntry[i] = 0;
        }

        int128 reward = (positionValue * LIQUIDATION_FEE) / 1e4;

        // reduce collateral
        _traderPosition.amountUsdc -= reward;

        return uint128(reward);
    }

    /**
     * @notice Gets min collateral
     * MinCollateral = 0.075 * S * (|2*S*a_{sqeeth}+a_{future}| + 0.15*S*|a_{sqeeth}|)
     * @return MinCollateral scaled by 1e6
     */
    function getMinCollateral(TraderPosition memory _traderPosition, uint128 _spotPrice)
        internal
        pure
        returns (int128)
    {
        uint128 maxDelta = Math.abs(
            (2 * int128(_spotPrice) * _traderPosition.amountAsset[0]) / 1e12 + _traderPosition.amountAsset[1]
        ) + (2 * RISK_PARAM_FOR_VAULT * _spotPrice * Math.abs(_traderPosition.amountAsset[0] / 1e12)) / 1e4;

        uint128 minCollateral = (RISK_PARAM_FOR_VAULT * _spotPrice * maxDelta) / (1e4 * 1e8);

        return (minCollateral / 1e2).toInt256().toInt128();
    }

    /**
     * @notice Gets position value
     * PositionValue = Σ(Price_{i} * a_{i} - entry_{i}) + USDC + FundingFee
     * @return PositionValue scaled by 1e6
     */
    function getPositionValue(TraderPosition memory _traderPosition, IPerpetualMarketCore.PoolState memory _poolParams)
        internal
        pure
        returns (int128)
    {
        int128 pnl = getSqeethAndFutureValue(_traderPosition, _poolParams);

        return
            pnl + _traderPosition.amountUsdc + getFundingFee(_traderPosition, _poolParams.cumFundingFeePerSizeGlobals);
    }

    /**
     * @notice Gets Sqeeth and Future value
     * SqeethAndFutureValue = Σ(Price_{i} * a_{i} - entry_{i})
     * @return SqeethAndFutureValue scaled by 1e6
     */
    function getSqeethAndFutureValue(
        TraderPosition memory _traderPosition,
        IPerpetualMarketCore.PoolState memory _poolParams
    ) internal pure returns (int128) {
        int128 pnl;

        for (uint128 i = 0; i < MAX_PRODUCT_ID; i++) {
            pnl += _poolParams.markPrices[i] * _traderPosition.amountAsset[i] - _traderPosition.valueEntry[i];
        }

        return pnl / 1e10;
    }

    /**
     * @notice Gets funding fee
     * FundingFee = Σ(FundingEntry_i - a_i*cumFundingGlobal_i)
     * @return FundingFee scaled by 1e6
     */
    function getFundingFee(TraderPosition memory _traderPosition, int128[2] memory _cumFundingFeePerSizeGlobal)
        internal
        pure
        returns (int128)
    {
        int128 fundingFee;

        for (uint128 i = 0; i < MAX_PRODUCT_ID; i++) {
            fundingFee +=
                _traderPosition.valueFundingFeeEntry[i] -
                _cumFundingFeePerSizeGlobal[i] *
                _traderPosition.amountAsset[i];
        }

        return fundingFee / 1e10;
    }
}
