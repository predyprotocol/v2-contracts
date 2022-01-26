//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../interfaces/IPerpetualMarketCore.sol";
import "./Math.sol";

/**
 * @title TraderVaultLib
 * Error codes
 * T0: PositionValue must be greater than MinCollateral
 * T1: PositionValue must be less than MinCollateral
 * T2: Vault is insolvent
 * T3: subVaultIndex is too large
 */
library TraderVaultLib {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeCast for uint128;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev risk parameter for MinCollateral calculation is 7.5%
    uint256 private constant RISK_PARAM_FOR_VAULT = 750;

    /// @dev liquidation fee is 50%
    int128 private constant LIQUIDATION_FEE = 5000;

    struct SubVault {
        int128[2] amountAsset;
        int128[2] valueEntry;
        int128[2] valueFundingFeeEntry;
    }

    struct TraderVault {
        int128 amountUsdc;
        SubVault[] subVaults;
        bool isInsolvent;
    }

    /**
     * @notice get amount of deposit required to add amount of Squees/Future
     * @param _ratio target MinCollateral / PositionValue ratio.
     * @return amount positive means required more collateral and negative means excess collateral.
     */
    function getAmountRequired(
        TraderVault storage _traderVault,
        int128 _ratio,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal view returns (int256 amount) {
        require(!_traderVault.isInsolvent, "T2");

        int256 positionValue = getPositionValue(_traderVault, _tradePriceInfo);
        int256 minCollateral = getMinCollateral(_traderVault, _tradePriceInfo.spotPrice);

        int256 requiredPositionValue = minCollateral.mul(1e8).div(_ratio);

        amount = requiredPositionValue - positionValue;
    }

    /**
     * @notice update USDC amount
     * @param _amount amount to add. if positive then increase amount, if negative then decrease amount.
     */
    function updateUsdcAmount(TraderVault storage _traderVault, int256 _amount) internal {
        _traderVault.amountUsdc = _traderVault.amountUsdc.add(_amount).toInt128();
    }

    /**
     * @notice get total amount of perpetual in a vault
     * @return assetAmounts are total amount of perpetual scaled by 1e8
     */
    function getAssetAmounts(TraderVault memory _traderVault) internal pure returns (int128[2] memory assetAmounts) {
        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            assetAmounts[i] = getAssetAmount(_traderVault, i);
        }
    }

    function getAssetAmount(TraderVault memory _traderVault, uint256 _productId)
        internal
        pure
        returns (int128 assetAmount)
    {
        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            assetAmount = assetAmount.add(_traderVault.subVaults[i].amountAsset[_productId]).toInt128();
        }
    }

    /**
     * @notice update positions in a vault
     * @param _amountAsset position size to increase or decrease
     * @param _valueEntry entry value to increase or decrease
     * @param _valueFundingFeeEntry entry value of funding fee
     */
    function updateVault(
        TraderVault storage _traderVault,
        uint256 _subVaultIndex,
        uint256 _productId,
        int128 _amountAsset,
        int256 _valueEntry,
        int256 _valueFundingFeeEntry
    ) internal {
        require(!_traderVault.isInsolvent, "T2");

        if (_traderVault.subVaults.length == _subVaultIndex) {
            int128[2] memory amountAsset;
            int128[2] memory valueEntry;
            int128[2] memory valueFundingFeeEntry;

            amountAsset[_productId] = _amountAsset;
            valueEntry[_productId] = _valueEntry.toInt128();
            valueFundingFeeEntry[_productId] = _valueFundingFeeEntry.toInt128();

            _traderVault.subVaults.push(SubVault(amountAsset, valueEntry, valueFundingFeeEntry));
        } else {
            require(_traderVault.subVaults.length > _subVaultIndex, "T3");

            SubVault storage subVault = _traderVault.subVaults[_subVaultIndex];

            subVault.amountAsset[_productId] = subVault.amountAsset[_productId].add(_amountAsset).toInt128();
            subVault.valueEntry[_productId] = subVault.valueEntry[_productId].add(_valueEntry).toInt128();
            subVault.valueFundingFeeEntry[_productId] = subVault
                .valueFundingFeeEntry[_productId]
                .add(_valueFundingFeeEntry)
                .toInt128();
        }
    }

    /**
     * @notice liquidate a vault whose PositionValue is less than MinCollateral
     */
    function liquidate(TraderVault storage _traderVault, IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        internal
        returns (uint128)
    {
        int256 positionValue = getPositionValue(_traderVault, _tradePriceInfo);

        require(positionValue < getMinCollateral(_traderVault, _tradePriceInfo.spotPrice), "T1");

        if (positionValue < 0) {
            _traderVault.isInsolvent = true;
            positionValue = 0;
        }

        // clean positions
        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            for (uint256 j = 0; j < MAX_PRODUCT_ID; j++) {
                _traderVault.subVaults[i].amountAsset[j] = 0;
                _traderVault.subVaults[i].valueEntry[j] = 0;
                _traderVault.subVaults[i].valueFundingFeeEntry[j] = 0;
            }
        }

        int128 reward = (positionValue.mul(LIQUIDATION_FEE) / 1e4).toInt128();

        // reduce collateral
        // sub is safe because we know reward is less than amountUsdc
        _traderVault.amountUsdc -= reward;

        return uint128(reward);
    }

    /**
     * @notice get min collateral
     * MinCollateral = 0.075 * S * (|2*S*a_{sqeeth}+a_{future}| + 0.15*S*|a_{sqeeth}|)
     * @return MinCollateral scaled by 1e6
     */
    function getMinCollateral(TraderVault memory _traderVault, uint256 _spotPrice) internal pure returns (int256) {
        int128[2] memory assetAmounts = getAssetAmounts(_traderVault);

        uint256 maxDelta = Math.abs(((2 * int256(_spotPrice).mul(assetAmounts[0])) / 1e12).add(assetAmounts[1])) +
            (2 * RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(Math.abs(assetAmounts[0] / 1e12))) /
            1e4;

        uint256 minCollateral = (RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(maxDelta)) / (1e12);

        return (minCollateral / 1e2).toInt256();
    }

    /**
     * @notice get position value in a parent vault
     * PositionValue = USDC + Σ(ValueOfSubVault_i)
     * @return PositionValue scaled by 1e6
     */
    function getPositionValue(
        TraderVault memory _traderVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 value = _traderVault.amountUsdc;

        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            value = value.add(getSubVaultPositionValue(_traderVault.subVaults[i], _tradePriceInfo));
        }

        return value;
    }

    /**
     * @notice Gets position value in a sub-vault
     * ValueOfSubVault = Σ(Price_{i} * a_{i} - entry_{i}) + FundingFee
     * @return ValueOfSubVault scaled by 1e6
     */
    function getSubVaultPositionValue(
        SubVault memory _subVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        return
            getTotalPerpetualValue(_subVault, _tradePriceInfo).add(
                getTotalFundingFee(_subVault, _tradePriceInfo.amountFundingFeesPerSize)
            );
    }

    /**
     * @notice Gets total perpetual value
     * TotalPerpetualValue = Σ(Price_{i} * a_{i} - entry_{i})
     * @return TotalPerpetualValue scaled by 1e6
     */
    function getTotalPerpetualValue(
        SubVault memory _subVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 pnl;

        for (uint128 i = 0; i < MAX_PRODUCT_ID; i++) {
            pnl = pnl.add(getPerpetualValue(_subVault, i, _tradePriceInfo));
        }

        return pnl;
    }

    /**
     * @notice get perpetual value
     * PerpetualValue = Price_{i} * a_{i} - entry_{i}
     * @return PerpetualValue scaled by 1e6
     */
    function getPerpetualValue(
        SubVault memory _subVault,
        uint256 _productId,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 pnl = _tradePriceInfo.tradePrices[_productId].mul(_subVault.amountAsset[_productId]).sub(
            _subVault.valueEntry[_productId]
        );

        return pnl / 1e10;
    }

    /**
     * @notice get total funding fee
     * TotalFundingFee = Σ(FundingEntry_i - a_i*cumFundingGlobal_i)
     * @return TotalFundingFee scaled by 1e6
     */
    function getTotalFundingFee(SubVault memory _subVault, int128[2] memory _amountFundingFeesPerSize)
        internal
        pure
        returns (int256)
    {
        int256 fundingFee;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            fundingFee = fundingFee.add(getFundingFee(_subVault, i, _amountFundingFeesPerSize));
        }

        return fundingFee;
    }

    /**
     * @notice get funding fee
     * FundingFee = FundingEntry_i - a_i*cumFundingGlobal_i
     * @return FundingFee scaled by 1e6
     */
    function getFundingFee(
        SubVault memory _subVault,
        uint256 _productId,
        int128[2] memory _amountFundingFeesPerSize
    ) internal pure returns (int256) {
        int256 fundingFee = _subVault.valueFundingFeeEntry[_productId].sub(
            _amountFundingFeesPerSize[_productId].mul(_subVault.amountAsset[_productId])
        );

        return fundingFee / 1e10;
    }
}
