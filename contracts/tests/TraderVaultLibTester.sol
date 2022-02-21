//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../interfaces/IPerpetualMarketCore.sol";
import "../lib/TraderVaultLib.sol";

/**
 * @title TraderVaultLibTester
 * @notice Tester contract for TraderVault library
 */
contract TraderVaultLibTester {
    TraderVaultLib.TraderVault public traderVault;
    int256 public r;

    function getNumOfSubVault() external view returns (uint256) {
        return traderVault.subVaults.length;
    }

    function getSubVault(uint256 _subVaultId) external view returns (TraderVaultLib.SubVault memory) {
        return traderVault.subVaults[_subVaultId];
    }

    function testUpdateVault(
        uint256 _subVaultId,
        uint256 _productId,
        int128 _amountAsset,
        uint256 _tradePrice,
        int128 _valueFundingFeeEntry
    ) external {
        TraderVaultLib.updateVault(
            traderVault,
            _subVaultId,
            _productId,
            _amountAsset,
            _tradePrice,
            _valueFundingFeeEntry
        );
    }

    function testGetMinCollateralToAddPosition(
        int128[2] memory _tradeAmounts,
        uint256 _spotPrice,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) external view returns (int256) {
        return TraderVaultLib.getMinCollateralToAddPosition(traderVault, _tradeAmounts, _spotPrice, _tradePriceInfo);
    }

    function testUpdateUsdcPosition(int256 _amount, IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
    {
        r = TraderVaultLib.updateUsdcPosition(traderVault, _amount, _tradePriceInfo);
    }

    function testCheckVaultIsLiquidatable(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (bool)
    {
        return TraderVaultLib.checkVaultIsLiquidatable(traderVault, _tradePriceInfo);
    }

    function testSetInsolvencyFlagIfNeeded() external {
        TraderVaultLib.setInsolvencyFlagIfNeeded(traderVault);
    }

    function testDecreaseLiquidationReward(int256 _minCollateral, int256 liquidationFee) external {
        r = int128(TraderVaultLib.decreaseLiquidationReward(traderVault, _minCollateral, liquidationFee));
    }

    function getMinCollateral(uint128 _spot) external view returns (int256) {
        return TraderVaultLib.getMinCollateral(traderVault, _spot);
    }

    function getPositionValue(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getPositionValue(traderVault, _tradePriceInfo);
    }
}
