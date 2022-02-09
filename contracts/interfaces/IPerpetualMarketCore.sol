// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/NettingLib.sol";

interface IPerpetualMarketCore {
    struct TradePriceInfo {
        uint128 spotPrice;
        int256[2] tradePrices;
        int128[2] amountsFundingPaidPerPosition;
    }

    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external returns (uint128 mintAmount);

    function deposit(uint128 _depositAmount) external returns (uint256 mintAmount);

    function withdraw(uint128 _withdrawnAmount) external returns (uint256 burnAmount);

    function addLiquidity(uint256 _amount) external;

    function updatePoolPosition(uint256 _productId, int128 _tradeAmount)
        external
        returns (
            uint256 tradePrice,
            int256,
            uint256 protocolFee
        );

    function completeHedgingProcedure(NettingLib.CompleteParams memory _completeParams) external;

    function updatePoolSnapshot() external;

    function executeFundingPayment() external;

    function getTradePriceInfo(int128[2] memory amountAssets) external view returns (TradePriceInfo memory);

    function getTradePrice(uint256 _productId, int128 _tradeAmount)
        external
        view
        returns (
            int256,
            int256,
            int256,
            int256,
            int256
        );

    function getTokenAmountForHedging() external view returns (NettingLib.CompleteParams memory completeParams);

    function getLPTokenPrice(int256 _deltaLiquidityAmount) external view returns (uint256);
}
