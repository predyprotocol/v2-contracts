// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/NettingLib.sol";

interface IPerpetualMarketCore {
    struct TradePriceInfo {
        uint128 spotPrice;
        int256[2] tradePrices;
        int256[2] fundingRates;
        int256[2] amountsFundingPaidPerPosition;
    }

    function initialize(
        address _depositor,
        uint256 _depositAmount,
        int256 _initialFundingRate
    ) external returns (uint256 mintAmount);

    function deposit(address _depositor, uint256 _depositAmount) external returns (uint256 mintAmount);

    function withdraw(address _withdrawer, uint256 _withdrawnAmount) external returns (uint256 burnAmount);

    function addLiquidity(uint256 _amount) external;

    function updatePoolPositions(int256[2] memory _tradeAmounts)
        external
        returns (
            uint256[2] memory tradePrice,
            int256[2] memory,
            uint256 protocolFee
        );

    function completeHedgingProcedure(NettingLib.CompleteParams memory _completeParams) external;

    function updatePoolSnapshot() external;

    function executeFundingPayment() external;

    function getTradePriceInfo(int256[2] memory _tradeAmounts) external view returns (TradePriceInfo memory);

    function getTradePrice(uint256 _productId, int256[2] memory _tradeAmounts)
        external
        view
        returns (
            int256,
            int256,
            int256,
            int256,
            int256
        );

    function rebalance() external;

    function getTokenAmountForHedging() external view returns (NettingLib.CompleteParams memory completeParams);

    function getLPTokenPrice(int256 _deltaLiquidityAmount) external view returns (uint256);
}
