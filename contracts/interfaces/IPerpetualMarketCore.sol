//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

interface IPerpetualMarketCore {
    struct PoolState {
        uint128 spotPrice;
        int128[2] markPrices;
        int128[2] amountFundingFeesPerSize;
    }

    function getPoolState() external view returns (PoolState memory);
}
