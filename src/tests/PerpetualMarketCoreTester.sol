//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../PerpetualMarketCore.sol";

/**
 * @title PerpetualMarketCoreTester
 * @notice Tester contract for Perpetual Market Core
 */
contract PerpetualMarketCoreTester is PerpetualMarketCore {
    uint256 public result;

    constructor(address _priceFeedAddress) PerpetualMarketCore(_priceFeedAddress, "TestLPToken", "TestLPToken") {}

    function setPoolStatus(
        uint256 _productId,
        int128 _positionPerpetuals,
        uint128 _lastFundingPaymentTime
    ) external {
        pools[_productId].positionPerpetuals = _positionPerpetuals;
        pools[_productId].lastFundingPaymentTime = _lastFundingPaymentTime;
    }

    function setPoolSnapshot(
        int128 _ethPrice,
        int128 _ethVariance,
        uint128 _lastSnapshotTime
    ) external {
        poolSnapshot.ethPrice = _ethPrice;
        poolSnapshot.ethVariance = _ethVariance;
        poolSnapshot.lastSnapshotTime = _lastSnapshotTime;
    }

    function verifyCalculateUnlockedLiquidity(
        uint256 _amountLockedLiquidity,
        int256 _deltaM,
        int256 _hedgePositionValue
    ) external pure returns (int256 deltaLiquidity, int256 unlockLiquidityAmount) {
        return calculateUnlockedLiquidity(_amountLockedLiquidity, _deltaM, _hedgePositionValue);
    }

    function verifyUpdatePoolPositions(uint256 _productId, int256[2] memory _tradeAmounts) external {
        (uint256[2] memory tradePrice, , ) = updatePoolPositions(_tradeAmounts);
        result = tradePrice[_productId];
    }

    function verifyUpdateVariance(uint256 _timestamp) external {
        updateVariance(_timestamp);
    }

    function verifyExecuteFundingPayment(uint256 _productId, int256 _spotPrice) external {
        _executeFundingPayment(_productId, _spotPrice);
    }

    function verifyCalculateResultOfFundingPayment(
        uint256 _productId,
        int256 _spotPrice,
        uint256 _currentTimestamp
    )
        external
        view
        returns (
            int256 currentFundingRate,
            int256 fundingFeePerPosition,
            int256 fundingReceived
        )
    {
        return calculateResultOfFundingPayment(_productId, _spotPrice, _currentTimestamp);
    }

    function verifyGetSignedMarginAmount(uint256 _productId) external view returns (int256) {
        return getSignedMarginAmount(pools[_productId].positionPerpetuals, _productId);
    }

    function verifyCalculateSignedDeltaMargin(
        MarginChange _marginChangeType,
        int256 _deltaMargin,
        int256 _currentMarginAmount
    ) external pure returns (int256) {
        return calculateSignedDeltaMargin(_marginChangeType, _deltaMargin, _currentMarginAmount);
    }

    function verifyCalculateFundingRate(
        uint256 _productId,
        int256 _margin,
        int256 _totalLiquidityAmount,
        int256 _deltaMargin,
        int256 _deltaLiquidity
    ) external view returns (int256) {
        return calculateFundingRate(_productId, _margin, _totalLiquidityAmount, _deltaMargin, _deltaLiquidity);
    }
}
