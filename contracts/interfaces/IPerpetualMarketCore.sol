//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

interface IPerpetualMarketCore {
    struct PoolState {
        uint128 spotPrice;
        int256[2] tradePrices;
        int128[2] amountFundingFeesPerSize;
    }

    function getPoolState(int128[2] memory amountAssets) external view returns (PoolState memory);
}
