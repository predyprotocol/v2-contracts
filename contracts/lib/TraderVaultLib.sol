//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../interfaces/IPerpetualMarketCore.sol";
import "./Math.sol";
import "./EntryPriceMath.sol";

/**
 * @title TraderVaultLib
 * @notice TraderVaultLib has functions to calculate position value and minimum collateral for implementing cross margin wallet.
 *
 * Data Structure
 *  Vault
 *  - PositionUSDC
 *  - SubVault0(PositionPerpetuals, EntryPrices, entryFundingFee)
 *  - SubVault1(PositionPerpetuals, EntryPrices, entryFundingFee)
 *  - ...
 *
 *  PositionPerpetuals = [PositionSqueeth, PositionFuture]
 *  EntryPrices = [EntryPriceSqueeth, EntryPriceFuture]
 *  entryFundingFee = [entryFundingFeeqeeth, FundingFeeEntryValueFuture]
 *
 *
 * Error codes
 *  T0: PositionValue must be greater than MinCollateral
 *  T1: PositionValue must be less than MinCollateral
 *  T2: Vault is insolvent
 *  T3: subVaultIndex is too large
 *  T4: ratio is too large
 */
library TraderVaultLib {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeCast for uint128;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev minimum margin is 100 USDC
    uint256 private constant MIN_MARGIN = 100 * 1e8;

    /// @dev risk parameter for MinCollateral calculation is 7.5%
    uint256 private constant RISK_PARAM_FOR_VAULT = 750;

    struct SubVault {
        int128[2] positionPerpetuals;
        uint128[2] entryPrices;
        int128[2] entryFundingFee;
    }

    struct TraderVault {
        int128 positionUsdc;
        SubVault[] subVaults;
        bool isInsolvent;
    }

    /**
     * @notice Gets amount of min collateral to add Squees/Future
     * @param _traderVault trader vault object
     * @param _spotPrice spot price
     * @param _tradePriceInfo trade price info
     * @return minCollateral and positionValue
     */
    function getMinCollateralToAddPosition(
        TraderVault memory _traderVault,
        int128[2] memory _tradeAmounts,
        uint256 _spotPrice,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256 minCollateral) {
        int128[2] memory positionPerpetuals = getPositionPerpetuals(_traderVault);

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            positionPerpetuals[i] = positionPerpetuals[i].add(_tradeAmounts[i]).toInt128();
        }

        minCollateral = calculateMinCollateral(
            positionPerpetuals,
            _spotPrice == 0 ? _tradePriceInfo.spotPrice : _spotPrice
        );
    }

    /**
     * @notice Updates USDC position
     * @param _traderVault trader vault object
     * @param _usdcPositionToAdd amount to add. if positive then increase amount, if negative then decrease amount.
     * @param _tradePriceInfo trade price info
     * @return finalUsdcPosition positive means amount of deposited margin
     * and negative means amount of withdrawn margin.
     */
    function updateUsdcPosition(
        TraderVault storage _traderVault,
        int256 _usdcPositionToAdd,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) external returns (int256 finalUsdcPosition) {
        finalUsdcPosition = _usdcPositionToAdd;
        require(!_traderVault.isInsolvent, "T2");

        int256 positionValue = getPositionValue(_traderVault, _tradePriceInfo);
        int256 minCollateral = getMinCollateral(_traderVault, _tradePriceInfo.spotPrice);
        int256 maxWithdrawable = positionValue - minCollateral;

        // If trader wants to withdraw all USDC, set maxWithdrawable.
        if (_usdcPositionToAdd < -maxWithdrawable && maxWithdrawable > 0 && _usdcPositionToAdd < 0) {
            finalUsdcPosition = -maxWithdrawable;
        }

        _traderVault.positionUsdc = _traderVault.positionUsdc.add(finalUsdcPosition).toInt128();

        require(!checkVaultIsLiquidatable(_traderVault, _tradePriceInfo), "T4");
    }

    /**
     * @notice Gets total position of perpetuals in the vault
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
     * @notice Gets position of a perpetual in the vault
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
     * @notice Updates positions in the vault
     * @param _traderVault trader vault object
     * @param _subVaultIndex index of sub-vault
     * @param _productId product id
     * @param _positionPerpetual amount of position to increase or decrease
     * @param _tradePrice trade price
     * @param _fundingFeePerPosition entry funding fee paid per position
     */
    function updateVault(
        TraderVault storage _traderVault,
        uint256 _subVaultIndex,
        uint256 _productId,
        int128 _positionPerpetual,
        uint256 _tradePrice,
        int256 _fundingFeePerPosition
    ) external returns (int256 deltaUsdcPosition) {
        require(!_traderVault.isInsolvent, "T2");
        require(_positionPerpetual != 0, "T4");

        if (_traderVault.subVaults.length == _subVaultIndex) {
            int128[2] memory positionPerpetuals;
            uint128[2] memory entryPrices;
            int128[2] memory entryFundingFee;

            _traderVault.subVaults.push(SubVault(positionPerpetuals, entryPrices, entryFundingFee));
        } else {
            require(_traderVault.subVaults.length > _subVaultIndex, "T3");
        }

        SubVault storage subVault = _traderVault.subVaults[_subVaultIndex];

        {
            (int256 newEntryPrice, int256 profitValue) = EntryPriceMath.updateEntryPrice(
                int256(subVault.entryPrices[_productId]),
                subVault.positionPerpetuals[_productId],
                int256(_tradePrice),
                _positionPerpetual
            );

            subVault.entryPrices[_productId] = newEntryPrice.toUint256().toUint128();
            deltaUsdcPosition = deltaUsdcPosition.add(profitValue);
        }

        {
            (int256 newEntryFundingFee, int256 profitValue) = EntryPriceMath.updateEntryPrice(
                int256(subVault.entryFundingFee[_productId]),
                subVault.positionPerpetuals[_productId],
                _fundingFeePerPosition,
                _positionPerpetual
            );

            subVault.entryFundingFee[_productId] = newEntryFundingFee.toInt128();
            deltaUsdcPosition = deltaUsdcPosition.sub(profitValue);
        }

        _traderVault.positionUsdc = _traderVault.positionUsdc.add(deltaUsdcPosition).toInt128();

        subVault.positionPerpetuals[_productId] = subVault
            .positionPerpetuals[_productId]
            .add(_positionPerpetual)
            .toInt128();
    }

    /**
     * @notice Checks the vault is liquidatable and return result
     * if PositionValue is less than MinCollateral return true
     * otherwise return false
     * @param _traderVault trader vault object
     * @return if true the vault is liquidatable, if false the vault is not liquidatable
     */
    function checkVaultIsLiquidatable(
        TraderVault memory _traderVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (bool) {
        int256 positionValue = getPositionValue(_traderVault, _tradePriceInfo);

        return positionValue < getMinCollateral(_traderVault, _tradePriceInfo.spotPrice);
    }

    /**
     * @notice Set insolvency flag if needed
     * If PositionValue is negative, set insolvency flag.
     * @param _traderVault trader vault object
     */
    function setInsolvencyFlagIfNeeded(TraderVault storage _traderVault) external {
        // Confirm that there are no positions
        for (uint256 i = 0; i < _traderVault.subVaults.length; i++) {
            for (uint256 j = 0; j < MAX_PRODUCT_ID; j++) {
                require(_traderVault.subVaults[i].positionPerpetuals[j] == 0);
            }
        }

        // If there are no positions, PositionUSDC is equal to PositionValue.
        if (_traderVault.positionUsdc < 0) {
            _traderVault.isInsolvent = true;
        }
    }

    /**
     * @notice Decreases liquidation reward from usdc position
     * @param _traderVault trader vault object
     * @param _minCollateral min collateral
     * @param _liquidationFee liquidation fee rate
     */
    function decreaseLiquidationReward(
        TraderVault storage _traderVault,
        int256 _minCollateral,
        int256 _liquidationFee
    ) external returns (uint256) {
        if (_traderVault.positionUsdc <= 0) {
            return 0;
        }

        int256 reward = _minCollateral.mul(_liquidationFee).div(1e4);

        reward = Math.min(reward, _traderVault.positionUsdc);

        // reduce margin
        // sub is safe because we know reward is less than positionUsdc
        _traderVault.positionUsdc -= reward.toInt128();

        return reward.toUint256();
    }

    /**
     * @notice Gets min collateral of the vault
     * @param _traderVault trader vault object
     * @param _spotPrice spot price
     * @return MinCollateral scaled by 1e8
     */
    function getMinCollateral(TraderVault memory _traderVault, uint256 _spotPrice) internal pure returns (int256) {
        int128[2] memory assetAmounts = getPositionPerpetuals(_traderVault);

        return calculateMinCollateral(assetAmounts, _spotPrice);
    }

    /**
     * @notice Calculates min collateral
     * MinCollateral = 0.075 * S * (|2*S*PositionSqueeth+PositionFuture| + 0.15*S*|PositionSqueeth|)
     * @param positionPerpetuals amount of perpetual positions
     * @param _spotPrice spot price
     * @return MinCollateral scaled by 1e8
     */
    function calculateMinCollateral(int128[2] memory positionPerpetuals, uint256 _spotPrice)
        internal
        pure
        returns (int256)
    {
        uint256 maxDelta = Math.abs(
            ((2 * int256(_spotPrice).mul(positionPerpetuals[0])) / 1e12).add(positionPerpetuals[1])
        ) + (2 * RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(Math.abs(positionPerpetuals[0] / 1e12))) / 1e4;

        uint256 minCollateral = (RISK_PARAM_FOR_VAULT.mul(_spotPrice).mul(maxDelta)) / 1e12;

        if ((positionPerpetuals[0] != 0 || positionPerpetuals[1] != 0) && minCollateral < MIN_MARGIN) {
            minCollateral = MIN_MARGIN;
        }

        return minCollateral.toInt256();
    }

    /**
     * @notice Gets position value in the vault
     * PositionValue = USDC + Σ(ValueOfSubVault_i)
     * @param _traderVault trader vault object
     * @param _tradePriceInfo trade price info
     * @return PositionValue scaled by 1e8
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
     * ValueOfSubVault = TotalPerpetualValueOfSubVault + TotalFundingFeePaidOfSubVault
     * @param _subVault sub-vault object
     * @param _tradePriceInfo trade price info
     * @return ValueOfSubVault scaled by 1e8
     */
    function getSubVaultPositionValue(
        SubVault memory _subVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        return
            getTotalPerpetualValueOfSubVault(_subVault, _tradePriceInfo).add(
                getTotalFundingFeePaidOfSubVault(_subVault, _tradePriceInfo.amountsFundingPaidPerPosition)
            );
    }

    /**
     * @notice Gets total perpetual value in the sub-vault
     * TotalPerpetualValueOfSubVault = Σ(PerpetualValueOfSubVault_i)
     * @param _subVault sub-vault object
     * @param _tradePriceInfo trade price info
     * @return TotalPerpetualValueOfSubVault scaled by 1e8
     */
    function getTotalPerpetualValueOfSubVault(
        SubVault memory _subVault,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 pnl;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            pnl = pnl.add(getPerpetualValueOfSubVault(_subVault, i, _tradePriceInfo));
        }

        return pnl;
    }

    /**
     * @notice Gets perpetual value in the sub-vault
     * PerpetualValueOfSubVault_i = (TradePrice_i - EntryPrice_i)*Position_i
     * @param _subVault sub-vault object
     * @param _productId product id
     * @param _tradePriceInfo trade price info
     * @return PerpetualValueOfSubVault_i scaled by 1e8
     */
    function getPerpetualValueOfSubVault(
        SubVault memory _subVault,
        uint256 _productId,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) internal pure returns (int256) {
        int256 pnl = _tradePriceInfo.tradePrices[_productId].sub(_subVault.entryPrices[_productId].toInt256()).mul(
            _subVault.positionPerpetuals[_productId]
        );

        return pnl / 1e8;
    }

    /**
     * @notice Gets total funding fee in the sub-vault
     * TotalFundingFeePaidOfSubVault = Σ(FundingFeePaidOfSubVault_i)
     * @param _subVault sub-vault object
     * @param _amountsFundingPaidPerPosition the cumulative funding fee paid by long per position
     * @return TotalFundingFeePaidOfSubVault scaled by 1e8
     */
    function getTotalFundingFeePaidOfSubVault(
        SubVault memory _subVault,
        int128[2] memory _amountsFundingPaidPerPosition
    ) internal pure returns (int256) {
        int256 fundingFee;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            fundingFee = fundingFee.add(getFundingFeePaidOfSubVault(_subVault, i, _amountsFundingPaidPerPosition));
        }

        return fundingFee;
    }

    /**
     * @notice Gets funding fee in the sub-vault
     * FundingFeePaidOfSubVault_i = Position_i*(EntryFundingFee_i - FundingFeeGlobal_i)
     * @param _subVault sub-vault object
     * @param _productId product id
     * @param _amountsFundingPaidPerPosition cumulative funding fee paid by long per position.
     * @return FundingFeePaidOfSubVault_i scaled by 1e8
     */
    function getFundingFeePaidOfSubVault(
        SubVault memory _subVault,
        uint256 _productId,
        int128[2] memory _amountsFundingPaidPerPosition
    ) internal pure returns (int256) {
        int256 fundingFee = _subVault.entryFundingFee[_productId].sub(_amountsFundingPaidPerPosition[_productId]).mul(
            _subVault.positionPerpetuals[_productId]
        );

        return fundingFee / 1e8;
    }
}
