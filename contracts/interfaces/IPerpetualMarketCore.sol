//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IPerpetualMarketCore {
    struct PoolState {
        uint128 spot;
        int128[2] markPrices;
        int128[2] cumFundingFeePerSizeGlobals;
    }

    function getPoolState() external view returns (PoolState memory);
}
