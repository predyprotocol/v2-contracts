//SPDX-License-Identifier: Unlicense
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
    int128 public r;

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

    function testGetAmountRequired(int128 _ratio, IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getAmountRequired(traderVault, _ratio, _tradePriceInfo);
    }

    function testUpdateUsdcPosition(int256 _amount) external {
        TraderVaultLib.updateUsdcPosition(traderVault, _amount);
    }

    function testLiquidate(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo) external {
        r = int128(TraderVaultLib.liquidate(traderVault, _tradePriceInfo));
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
