//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "forge-std/Test.sol";

import "../../src/PerpetualMarketCore.sol";

/**
 * @title PerpetualMarketCoreTester
 * @notice Tester contract for Perpetual Market Core
 */
contract PerpetualMarketCoreTest is Test {
    uint256 public result;
    PerpetualMarketCore pmc;

    function setUp() public {
        pmc = new PerpetualMarketCore(0x, "TestLPToken", "TestLPToken");
    }

    function testSetPoolStatus(
        uint256 _productId,
        int128 _positionPerpetuals,
        uint128 _lastFundingPaymentTime
    ) external {
        pmc.pools[_productId].positionPerpetuals = _positionPerpetuals;
        pmc.pools[_productId].lastFundingPaymentTime = _lastFundingPaymentTime;
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

    function testCalculateUnlockedLiquidity(
        uint256 _amountLockedLiquidity,
        int256 _deltaM,
        int256 _hedgePositionValue
    ) external pure returns (int256 deltaLiquidity, int256 unlockLiquidityAmount) {
        return calculateUnlockedLiquidity(_amountLockedLiquidity, _deltaM, _hedgePositionValue);
    }

    function testUpdatePoolPositions(uint256 _productId, int256[2] memory _tradeAmounts) external {
        (uint256[2] memory tradePrice, , ) = updatePoolPositions(_tradeAmounts);
        result = tradePrice[_productId];
    }

    function testUpdateVariance(uint256 _timestamp) external {
        updateVariance(_timestamp);
    }

    function testExecuteFundingPayment(uint256 _productId, int256 _spotPrice) external {
        _executeFundingPayment(_productId, _spotPrice);
    }

    function testCalculateResultOfFundingPayment(
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

    function testGetSignedMarginAmount(uint256 _productId) external view returns (int256) {
        return getSignedMarginAmount(pools[_productId].positionPerpetuals, _productId);
    }

    function testCalculateSignedDeltaMargin(
        PerpetualMarketCore.MarginChange _marginChangeType,
        int256 _deltaMargin,
        int256 _currentMarginAmount
    ) external pure returns (int256) {
        return calculateSignedDeltaMargin(_marginChangeType, _deltaMargin, _currentMarginAmount);
    }

    function testCalculateFundingRate(
        uint256 _productId,
        int256 _margin,
        int256 _totalLiquidityAmount,
        int256 _deltaMargin,
        int256 _deltaLiquidity
    ) external view returns (int256) {
        return calculateFundingRate(_productId, _margin, _totalLiquidityAmount, _deltaMargin, _deltaLiquidity);
    }
}
