//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/TraderVaultLib.sol";

/**
 * @title TraderVaultLibTester
 * @notice Tester contract for TraderVault library
 */
contract TraderVaultLibTester {
    TraderVaultLib.TraderPosition public traderPosition;
    int128 public r;

    function testUpdatePosition(
        uint256 _poolId,
        int128 _size,
        int128 _entry,
        int128 _cumulativeFundingFeeEntry
    ) external {
        TraderVaultLib.updatePosition(traderPosition, _poolId, _size, _entry, _cumulativeFundingFeeEntry);
    }

    function testDepositOrWithdraw(
        int128 _targetMinCollateralPerPositionValueRatio,
        uint128 _spot,
        TraderVaultLib.PoolParams memory _poolParams
    ) external {
        r = TraderVaultLib.depositOrWithdraw(
            traderPosition,
            _targetMinCollateralPerPositionValueRatio,
            _spot,
            _poolParams
        );
    }

    function testLiquidate(uint128 _spot, TraderVaultLib.PoolParams memory _poolParams) external {
        r = int128(TraderVaultLib.liquidate(traderPosition, _spot, _poolParams));
    }

    function getMinCollateral(uint128 _spot) external view returns (int128) {
        return TraderVaultLib.getMinCollateral(traderPosition, _spot);
    }

    function getPositionValue(TraderVaultLib.PoolParams memory _poolParams) external view returns (int128) {
        return TraderVaultLib.getPositionValue(traderPosition, _poolParams);
    }
}
