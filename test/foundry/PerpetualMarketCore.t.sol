//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "forge-std/Test.sol";

import "../../src/PerpetualMarketCore.sol";
import "../../src/PerpetualMarket.sol";
import "../../src/FeePool.sol";
import "../../src/VaultNFT.sol";
import "../../src/mocks/MockChainlinkAggregator.sol";
import "../../src/mocks/MockERC20.sol";

/**
 * @title PerpetualMarketCoreTester
 * @notice Tester contract for Perpetual Market Core
 */
contract PerpetualMarketCoreTest is Test {
    uint256 public result;
    PerpetualMarketCore pmc;
    PerpetualMarket pm;
    MockERC20 usdc;
    MockERC20 weth;
    FeePool feePool;
    VaultNFT vaultNFT;

    function setUp() public {
        MockChainlinkAggregator aggregator = new MockChainlinkAggregator();
        aggregator.setLatestRoundData(0, 1000 * 10 ** 8);
        pmc = new PerpetualMarketCore(address(aggregator), "TestLPToken", "TestLPToken");
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        feePool = new FeePool(usdc);
        vaultNFT = new VaultNFT("Vault NFT", "Delta-Gamma-Vault", "http://example.com");
        pm = new PerpetualMarket(address(pmc), address(usdc), address(weth), address(feePool), address(vaultNFT));
    }

    function testSetPerpetualMarket() public {
        pmc.setPerpetualMarket(address(pm));
    }

    function testInitialize() public {
        this.testSetPerpetualMarket();
        vm.prank(address(pm));
        pmc.initialize(address(this), 1000, 5 * 10 ** 5);
    }

    function testDeposit() public {
        this.testInitialize();
        vm.prank(address(pm));
        pmc.deposit(address(this), 1000);
    }

    function testDepositFuzzing(uint128 _depositAmount) public {
        this.testInitialize();
        vm.prank(address(pm));
        pmc.deposit(address(this), _depositAmount);
    }

    function testFailDeposit() public {
        this.testInitialize();
        pmc.deposit(address(this), 1000);
    }

    function testWithdraw()public {
        this.testDeposit();
        vm.prank(address(pm));
        pmc.withdraw(address(this), 1000);
    }

    function testFailWithdraw()public {
        this.testDeposit();
        pmc.withdraw(address(this), 1000);
    }

    // function testSetPoolStatus(
    //     uint256 _productId,
    //     int128 _positionPerpetuals,
    //     uint128 _lastFundingPaymentTime
    // ) external {
    //     pmc.pools;
    //     // pmc.pools[_productId] = (
    //     //     pmc.pools[_productId].amountLockedLiquidity,
    //     //     _positionPerpetuals,
    //     //     pmc.pools[_productId].entryPrice,
    //     //     pmc.pools[_productId].amountFundingPaidPerPosition,
    //     //     _lastFundingPaymentTime
    //     // );
    // }

    // function setPoolSnapshot(
    //     int128 _ethPrice,
    //     int128 _ethVariance,
    //     uint128 _lastSnapshotTime
    // ) external {
    //     pmc.poolSnapshot.ethPrice = _ethPrice;
    //     pmc.poolSnapshot.ethVariance = _ethVariance;
    //     pmc.poolSnapshot.lastSnapshotTime = _lastSnapshotTime;
    // }

    // function testCalculateUnlockedLiquidity(
    //     uint256 _amountLockedLiquidity,
    //     int256 _deltaM,
    //     int256 _hedgePositionValue
    // ) external pure returns (int256 deltaLiquidity, int256 unlockLiquidityAmount) {
    //     return pmc.calculateUnlockedLiquidity(_amountLockedLiquidity, _deltaM, _hedgePositionValue);
    // }

    // function testUpdatePoolPositions(uint256 _productId, int256[2] memory _tradeAmounts) external {
    //     (uint256[2] memory tradePrice, , ) = pmc.updatePoolPositions(_tradeAmounts);
    //     result = tradePrice[_productId];
    // }

    // function testUpdateVariance(uint256 _timestamp) external {
    //     pmc.updateVariance(_timestamp);
    // }

    // function testExecuteFundingPayment(uint256 _productId, int256 _spotPrice) external {
    //     _executeFundingPayment(_productId, _spotPrice);
    // }

    // function testCalculateResultOfFundingPayment(
    //     uint256 _productId,
    //     int256 _spotPrice,
    //     uint256 _currentTimestamp
    // )
    //     external
    //     view
    //     returns (
    //         int256 currentFundingRate,
    //         int256 fundingFeePerPosition,
    //         int256 fundingReceived
    //     )
    // {
    //     return pmc.calculateResultOfFundingPayment(_productId, _spotPrice, _currentTimestamp);
    // }

    // function testGetSignedMarginAmount(uint256 _productId) external view returns (int256) {
    //     return pmc.getSignedMarginAmount(pmc.pools[_productId].positionPerpetuals, _productId);
    // }

    // function testCalculateSignedDeltaMargin(
    //     PerpetualMarketCore.MarginChange _marginChangeType,
    //     int256 _deltaMargin,
    //     int256 _currentMarginAmount
    // ) external pure returns (int256) {
    //     return pmc.calculateSignedDeltaMargin(_marginChangeType, _deltaMargin, _currentMarginAmount);
    // }

    // function testCalculateFundingRate(
    //     uint256 _productId,
    //     int256 _margin,
    //     int256 _totalLiquidityAmount,
    //     int256 _deltaMargin,
    //     int256 _deltaLiquidity
    // ) external view returns (int256) {
    //     return pmc.calculateFundingRate(_productId, _margin, _totalLiquidityAmount, _deltaMargin, _deltaLiquidity);
    // }
}
