//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/IPerpetualMarketCore.sol";
import "../lib/TraderVaultLib.sol";

/**
 * @title TraderVaultLibTester
 * @notice Tester contract for TraderVault library
 */
contract TraderVaultLibTester {
    TraderVaultLib.TraderPosition public traderPosition;
    int128 public r;

    function testUpdateVault(
        uint256 _poolId,
        int128 _amountAsset,
        int128 _valueEntry,
        int128 _valueFundingFeeEntry
    ) external {
        TraderVaultLib.updateVault(traderPosition, _poolId, _amountAsset, _valueEntry, _valueFundingFeeEntry);
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
