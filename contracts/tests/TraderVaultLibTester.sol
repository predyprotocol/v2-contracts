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
    TraderVaultLib.TraderVault public traderPosition;
    int128 public r;

    function testUpdateVault(
        uint256 _productId,
        int128 _amountAsset,
        int128 _valueEntry,
        int128 _valueFundingFeeEntry
    ) external {
        TraderVaultLib.updateVault(traderPosition, _productId, _amountAsset, _valueEntry, _valueFundingFeeEntry);
    }

    function testGetAmountRequired(int128 _ratio, IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getAmountRequired(traderPosition, _ratio, _tradePriceInfo);
    }

    function testUpdateUsdcAmount(int256 _amount) external {
        TraderVaultLib.updateUsdcAmount(traderPosition, _amount);
    }

    function testLiquidate(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo) external {
        r = int128(TraderVaultLib.liquidate(traderPosition, _tradePriceInfo));
    }

    function getMinCollateral(uint128 _spot) external view returns (int256) {
        return TraderVaultLib.getMinCollateral(traderPosition, _spot);
    }

    function getPositionValue(IPerpetualMarketCore.TradePriceInfo memory _tradePriceInfo)
        external
        view
        returns (int256)
    {
        return TraderVaultLib.getPositionValue(traderPosition, _tradePriceInfo);
    }
}
