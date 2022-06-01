//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "forge-std/Test.sol";

import "../../src/interfaces/IPerpetualMarketCore.sol";
import "../../src/lib/TraderVaultLib.sol";

/**
 * @title TraderVaultLibTester
 * @notice Tester contract for TraderVault library
 */
contract TraderVaultLibTest is Test {
    TraderVaultLib.TraderVault public traderVault;
    int256 public r;

    function clear() external {
        delete traderVault;
    }

    function testGetNumOfSubVault() external view returns (uint256) {
        return traderVault.subVaults.length;
    }

    function testGetSubVault(uint256 _subVaultId) external view returns (TraderVaultLib.SubVault memory) {
        return traderVault.subVaults[_subVaultId];
    }

    function testUpdateVault(
        uint256 _subVaultId,
        uint256 _productId,
        int128 _amountAsset,
        uint256 _tradePrice,
        int128 _fundingFeePerPosition
    ) external {
        TraderVaultLib.updateVault(
            traderVault,
            _subVaultId,
            _productId,
            _amountAsset,
            _tradePrice,
            _fundingFeePerPosition
        );
    }

    function testGetMinCollateralToAddPosition(
        int128[2] memory _tradeAmounts,
        IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo
    ) external view returns (int256) {
        return TraderVaultLib.getMinCollateralToAddPosition(traderVault, _tradeAmounts, _tradePriceInfo);
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

    function testDecreaseLiquidationReward(int256 _minCollateral, int256 liquidationFee) external {
        r = int128(TraderVaultLib.decreaseLiquidationReward(traderVault, _minCollateral, liquidationFee));
    }

    function testGetMinCollateral(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getMinCollateral(traderVault, _tradePriceInfo);
    }

    function testGetPositionValue(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getPositionValue(traderVault, _tradePriceInfo);
    }
}
