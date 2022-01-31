//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../interfaces/IPerpetualMarketCore.sol";
import "./Math.sol";
import "./EntryPriceMath.sol";

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
        int128[2] positionPerpetuals;
        uint128[2] entryPrice;
        int128[2] valueFundingFeeEntry;
    }

    struct TraderVault {
        int128 positionUsdc;
        SubVault[] subVaults;
        bool isInsolvent;
    }

    /**
     * @notice get amount of deposit required to add amount of Squees/Future
     * @param _traderVault trader vault object
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
     * @notice update USDC position
     * @param _traderVault trader vault object
     * @param _usdcPosition amount to add. if positive then increase amount, if negative then decrease amount.
     */
    function updateUsdcPosition(TraderVault storage _traderVault, int256 _usdcPosition) internal {
        _traderVault.positionUsdc = _traderVault.positionUsdc.add(_usdcPosition).toInt128();
    }

    /**
     * @notice get total position of perpetuals in the vault
     * @param _traderVault trader vault object
     * @return positionPerpetuals are total amount of perpetual scaled by 1e8
     */
    function getPositionPerpetuals(TraderVault memory _traderVault)
        internal
        pure
        returns (int128[2] memory positionPerpetuals)
    {
        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            positionPerpetuals[i] = getPositionPerpetual(_traderVault, i);
        }
    }

    /**
     * @notice get position of a perpetual in the vault
     * @param _traderVault trader vault object
     * @param _productId product id
     * @return positionPerpetual is amount of perpetual scaled by 1e8
     */
    function getPositionPerpetual(TraderVault memory _traderVault, uint256 _productId)
        internal
        pure
        returns (int128 positionPerpetual)
    {
        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            positionPerpetual = positionPerpetual
                .add(_traderVault.subVaults[i].positionPerpetuals[_productId])
                .toInt128();
        }
    }

    /**
     * @notice update positions in the vault
     * @param _traderVault trader vault object
     * @param _subVaultIndex index of sub-vault
     * @param _productId product id
     * @param _positionPerpetual amount of position to increase or decrease
     * @param _tradePrice trade price
     * @param _valueFundingFeeEntry entry value of funding fee
     */
    function updateVault(
        TraderVault storage _traderVault,
        uint256 _subVaultIndex,
        uint256 _productId,
        int128 _positionPerpetual,
        uint256 _tradePrice,
        int256 _valueFundingFeeEntry
    ) internal {
        require(!_traderVault.isInsolvent, "T2");

        if (_traderVault.subVaults.length == _subVaultIndex) {
            int128[2] memory positionPerpetuals;
            uint128[2] memory entryPrice;
            int128[2] memory valueFundingFeeEntry;

            _traderVault.subVaults.push(SubVault(positionPerpetuals, entryPrice, valueFundingFeeEntry));
        } else {
            require(_traderVault.subVaults.length > _subVaultIndex, "T3");
        }

        SubVault storage subVault = _traderVault.subVaults[_subVaultIndex];

        (uint256 newEntryPrice, int256 profitValue) = EntryPriceMath.updateEntryPrice(
            subVault.entryPrice[_productId],
            subVault.positionPerpetuals[_productId],
            _tradePrice,
            _positionPerpetual
        );

        subVault.entryPrice[_productId] = newEntryPrice.toUint128();
        _traderVault.positionUsdc = _traderVault.positionUsdc.add(profitValue / 1e2).toInt128();

        subVault.positionPerpetuals[_productId] = subVault
            .positionPerpetuals[_productId]
            .add(_positionPerpetual)
            .toInt128();
        subVault.valueFundingFeeEntry[_productId] = subVault
            .valueFundingFeeEntry[_productId]
            .add(_valueFundingFeeEntry)
            .toInt128();
    }

    /**
     * @notice liquidate the vault whose PositionValue is less than MinCollateral
     * @param _traderVault trader vault object
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
                _traderVault.subVaults[i].positionPerpetuals[j] = 0;
                _traderVault.subVaults[i].entryPrice[j] = 0;
                _traderVault.subVaults[i].valueFundingFeeEntry[j] = 0;
            }
        }

        int128 reward = (positionValue.mul(LIQUIDATION_FEE) / 1e4).toInt128();

        // reduce collateral
        // sub is safe because we know reward is less than positionUsdc
        _traderVault.positionUsdc -= reward;

        return uint128(reward);
    }

    /**
     * @notice get min collateral of the vault
     * MinCollateral = 0.075 * S * (|2*S*a_{sqeeth}+a_{future}| + 0.15*S*|a_{sqeeth}|)
     * @param _traderVault trader vault object
     * @param _spotPrice spot price
     * @return MinCollateral scaled by 1e6
     */
    function getMinCollateral(TraderVault memory _traderVault, uint256 _spotPrice) internal pure returns (int256) {
        int128[2] memory assetAmounts = getPositionPerpetuals(_traderVault);

        uint256 maxDelta = Math.abs(((2 * int256(_spotPrice).mul(assetAmounts[0])) / 1e12).add(assetAmounts[1])) +
            (2 * RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(Math.abs(assetAmounts[0] / 1e12))) /
            1e4;

        uint256 minCollateral = (RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(maxDelta)) / (1e12);

        return (minCollateral / 1e2).toInt256();
    }

    /**
     * @notice get position value in the vault
     * PositionValue = USDC + Σ(ValueOfSubVault_i)
     * @param _traderVault trader vault object
     * @param _tradePriceInfo trade price info
     * @return PositionValue scaled by 1e6
     */
    function getPositionValue(
        TraderVault memory _traderVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 value = _traderVault.positionUsdc;

        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            value = value.add(getSubVaultPositionValue(_traderVault.subVaults[i], _tradePriceInfo));
        }

        return value;
    }

    /**
     * @notice Gets position value in the sub-vault
     * ValueOfSubVault = Σ(Price_{i} * a_{i} - entry_{i}) + FundingFee
     * @param _subVault sub-vault object
     * @param _tradePriceInfo trade price info
     * @return ValueOfSubVault scaled by 1e6
     */
    function getSubVaultPositionValue(
        SubVault memory _subVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        return
            getTotalPerpetualValue(_subVault, _tradePriceInfo).add(
                getTotalFundingFee(_subVault, _tradePriceInfo.amountFundingFeesPerPosition)
            );
    }

    /**
     * @notice Gets total perpetual value in the sub-vault
     * TotalPerpetualValue = Σ(Price_{i} * a_{i} - entry_{i})
     * @param _subVault sub-vault object
     * @param _tradePriceInfo trade price info
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
     * @notice get perpetual value in the sub-vault
     * PerpetualValue = Price_{i} * a_{i} - entry_{i}
     * @param _subVault sub-vault object
     * @param _productId product id
     * @param _tradePriceInfo trade price info
     * @return PerpetualValue scaled by 1e6
     */
    function getPerpetualValue(
        SubVault memory _subVault,
        uint256 _productId,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 pnl = _tradePriceInfo.tradePrices[_productId].sub(_subVault.entryPrice[_productId].toInt256()).mul(
            _subVault.positionPerpetuals[_productId]
        );

        return pnl / 1e10;
    }

    /**
     * @notice get total funding fee in the sub-vault
     * TotalFundingFee = Σ(FundingEntry_i - a_i*cumFundingGlobal_i)
     * @param _subVault sub-vault object
     * @param _amountFundingFeesPerPosition cumulative funding fee per position
     * @return TotalFundingFee scaled by 1e6
     */
    function getTotalFundingFee(SubVault memory _subVault, int128[2] memory _amountFundingFeesPerPosition)
        internal
        pure
        returns (int256)
    {
        int256 fundingFee;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            fundingFee = fundingFee.add(getFundingFee(_subVault, i, _amountFundingFeesPerPosition));
        }

        return fundingFee;
    }

    /**
     * @notice get funding fee in the sub-vault
     * FundingFee = FundingEntry_i - a_i*cumFundingGlobal_i
     * @param _subVault sub-vault object
     * @param _productId product id
     * @param _amountFundingFeesPerPosition cumulative funding fee per position
     * @return FundingFee scaled by 1e6
     */
    function getFundingFee(
        SubVault memory _subVault,
        uint256 _productId,
        int128[2] memory _amountFundingFeesPerPosition
    ) internal pure returns (int256) {
        int256 fundingFee = _subVault.valueFundingFeeEntry[_productId].sub(
            _amountFundingFeesPerPosition[_productId].mul(_subVault.positionPerpetuals[_productId])
        );

        return fundingFee / 1e10;
    }
}
