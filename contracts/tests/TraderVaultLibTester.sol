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

    function testGetAmountRequired(int128 _ratio, IPerpetualMarketCore.PoolState memory _poolParams)
        external
        view
        returns (int128)
    {
        return TraderVaultLib.getAmountRequired(traderPosition, _ratio, _poolParams);
    }

    function testUpdateUsdcAmount(int128 _amount) external {
        TraderVaultLib.updateUsdcAmount(traderPosition, _amount);
    }

    function testLiquidate(IPerpetualMarketCore.PoolState memory _poolParams) external {
        r = int128(TraderVaultLib.liquidate(traderPosition, _poolParams));
    }

    function getMinCollateral(uint128 _spot) external view returns (int128) {
        return TraderVaultLib.getMinCollateral(traderPosition, _spot);
    }

    function getPositionValue(IPerpetualMarketCore.PoolState memory _poolParams) external view returns (int128) {
        return TraderVaultLib.getPositionValue(traderPosition, _poolParams);
    }
}
