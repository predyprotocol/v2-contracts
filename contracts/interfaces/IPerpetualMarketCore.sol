//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

interface IPerpetualMarketCore {
    struct TradePriceInfo {
        uint128 spotPrice;
        int256[2] tradePrices;
        int128[2] amountFundingFeesPerSize;
    }

    function getTradePriceInfo(int128[2] memory amountAssets) external view returns (TradePriceInfo memory);
}
