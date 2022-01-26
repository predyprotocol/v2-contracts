//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./lib/NettingLib.sol";
import "./lib/Pricer.sol";
import "./lib/SpreadLib.sol";
import "hardhat/console.sol";

/**
 * @title PerpetualMarketCore
 * @notice Perpetual Market Core Contract
 * Error Code
 * PMC0: No available liquidity
 * PMC1: No available liquidity
 * PMC2: caller must be PerpetualMarket contract
 * PMC3: underlying price must not be 0
 */
contract PerpetualMarketCore is IPerpetualMarketCore {
    using NettingLib for NettingLib.Info;
    using NettingLib for NettingLib.PoolInfo;
    using SpreadLib for SpreadLib.Info;
    using SafeCast for uint256;
    using SafeCast for uint128;
    using SafeCast for int256;
    using SafeMath for uint256;
    using SafeMath for uint128;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;

    uint256 private constant MAX_PRODUCT_ID = 2;

    // max ratio of (IV/RV)^2 for sqeeth pool is 50 %
    int128 private constant BETA_UR = 50 * 1e6;

    // λ for exponentially weighted moving average is 94%
    int128 private constant LAMBDA = 94 * 1e6;

    // max funding rate of future pool is 0.02 %
    int128 private constant MAX_FUNDING_RATE = 2 * 1e4;

    // funding period is 1 days
    int128 private constant FUNDING_PERIOD = 1 days;

    // max drawdown of hedging is 0.7%
    uint128 private constant MAX_DRAWDOWN = 70;

    struct Pool {
        uint128 amountLockedLiquidity;
        int128 amountAsset;
        int128 valueEntry;
        int128 amountFundingFeePerSize;
        uint128 lastTradeTime;
    }

    struct PoolSnapshot {
        int128 deltaImpact;
        int128 ethVariance;
        int128 ethPrice;
        uint128 lastSnapshotTime;
    }

    // Total supply of the LP token
    uint256 public supply;

    // Total amount of liquidity provided by LPs
    uint256 public amountLiquidity;

    // Pools information storage
    mapping(uint256 => Pool) public pools;

    // Infos for spread calculation
    mapping(uint256 => SpreadLib.Info) private spreadInfos;

    // Snapshot of pool state at last ETH variance calculation
    PoolSnapshot private poolSnapshot;

    // Infos for collateral calculation
    NettingLib.Info private nettingInfo;

    // Chainlink price feed address
    AggregatorV3Interface private priceFeed;

    // The last timestamp of hedging
    uint128 public lastHedgeTime;

    // The address of Perpetual Market Contract
    address private perpetualMarket;

    event FundingPayment(uint256 productId, int256 fundingRate, int256 fundingPaidPerSize, int256 poolReceived);

    modifier onlyPerpetualMarket() {
        require(msg.sender == perpetualMarket, "PMC2");
        _;
    }

    constructor(address _priceFeedAddress) {
        priceFeed = AggregatorV3Interface(_priceFeedAddress);

        // initialize spread infos
        spreadInfos[0].init();
        spreadInfos[1].init();

        perpetualMarket = msg.sender;
    }

    function setPerpetualMarket(address _perpetualMarket) external onlyPerpetualMarket {
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice initialize pool with initial liquidity and funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate)
        external
        onlyPerpetualMarket
        returns (uint128 mintAmount)
    {
        require(supply == 0);
        mintAmount = _depositAmount;

        (int256 spotPrice, ) = getUnderlyingPrice();

        poolSnapshot.ethVariance = _initialFundingRate;
        poolSnapshot.ethPrice = spotPrice.toInt128();
        poolSnapshot.lastSnapshotTime = block.timestamp.toUint128();

        amountLiquidity = amountLiquidity.add(_depositAmount);
        supply = supply.add(mintAmount);
    }

    /**
     * @notice provide liquidity
     */
    function deposit(uint128 _depositAmount) external onlyPerpetualMarket returns (uint256 mintAmount) {
        require(supply > 0);

        mintAmount = _depositAmount.mul(1e6).div(getLPTokenPrice());

        amountLiquidity = amountLiquidity.add(_depositAmount);
        supply = supply.add(mintAmount);
    }

    /**
     * @notice withdraw liquidity
     */
    function withdraw(uint128 _withdrawnAmount) external onlyPerpetualMarket returns (uint256 burnAmount) {
        burnAmount = _withdrawnAmount.mul(1e6).div(getLPTokenPrice());

        require(
            amountLiquidity.sub(pools[0].amountLockedLiquidity).sub(pools[1].amountLockedLiquidity) >= _withdrawnAmount,
            "PMC0"
        );

        amountLiquidity = amountLiquidity.sub(_withdrawnAmount);
        supply = supply.sub(burnAmount);
    }

    function addLiquidity(uint128 _amount) external onlyPerpetualMarket {
        amountLiquidity = amountLiquidity.add(_amount);
    }

    /**
     * @notice add or remove positions
     * @param _productId product id
     * @param _tradeAmount size to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _productId, int128 _tradeAmount)
        external
        onlyPerpetualMarket
        returns (int256, int256)
    {
        require(amountLiquidity > 0, "PMC1");

        (int256 spotPrice, ) = getUnderlyingPrice();

        // Funding payment
        executeFundingPayment(_productId, spotPrice);

        // Updates position size
        pools[_productId].amountAsset += _tradeAmount;

        // Add collateral to Netting contract
        (int256 deltaM, int256 hedgePositionValue) = addCollateral(_productId, spotPrice);

        // Calculate trade price
        int256 tradePrice = calculateTradePriceByDeltaCollateral(_productId, spotPrice, deltaM);

        // Manages spread
        tradePrice = spreadInfos[_productId].checkPrice(_tradeAmount > 0, tradePrice);

        {
            // Calculate pool's new amountLiquidity
            int256 poolPofit = calculatePoolProfit(_productId, _tradeAmount, deltaM, tradePrice, hedgePositionValue);

            // Updates locked liquidity amount
            if (deltaM > 0) {
                require(amountLiquidity.sub(pools[_productId].amountLockedLiquidity) >= uint128(deltaM / 1e2), "PMC1");
                pools[_productId].amountLockedLiquidity = pools[_productId]
                    .amountLockedLiquidity
                    .add(uint128(deltaM / 1e2))
                    .toUint128();
            } else if (deltaM < 0) {
                pools[_productId].amountLockedLiquidity = (
                    pools[_productId].amountLockedLiquidity.mul(uint128(hedgePositionValue + deltaM))
                ).div(uint128(hedgePositionValue)).toUint128();
            }

            amountLiquidity = Math.addDelta(amountLiquidity, poolPofit);
        }

        // Update trade time
        pools[_productId].lastTradeTime = uint128(block.timestamp);

        if (
            (_tradeAmount < 0 && pools[_productId].amountAsset.sub(_tradeAmount) > 0) ||
            (_tradeAmount > 0 && pools[_productId].amountAsset.sub(_tradeAmount) < 0)
        ) {
            pools[_productId].valueEntry = pools[_productId]
                .valueEntry
                .add(
                    (pools[_productId].valueEntry.mul(_tradeAmount)).div(
                        pools[_productId].amountAsset.sub(_tradeAmount)
                    )
                )
                .toInt128();
        } else {
            pools[_productId].valueEntry = pools[_productId].valueEntry.add(tradePrice.mul(_tradeAmount)).toInt128();
        }

        return (tradePrice.mul(_tradeAmount), pools[_productId].amountFundingFeePerSize.mul(_tradeAmount));
    }

    /**
     * @notice Calculates USDC amount and underlying amount for delta neutral
     * and store valueEntry price in netting info
     */
    function calculateEntryPriceForHedging()
        external
        onlyPerpetualMarket
        returns (
            bool isLong,
            uint256 underlyingAmount,
            uint256 usdcAmount
        )
    {
        (int256 spotPrice, ) = getUnderlyingPrice();

        (int256 sqeethPoolDelta, int256 futurePoolDelta) = getDeltas(
            spotPrice,
            pools[0].amountAsset,
            pools[1].amountAsset
        );

        {
            // 1. Calculate net delta
            int256 netDelta = sqeethPoolDelta.add(futurePoolDelta).add(nettingInfo.amountUnderlying);

            isLong = netDelta < 0;

            // 2. Calculate USDC and ETH amounts.
            underlyingAmount = Math.abs(netDelta) * 1e10;
            usdcAmount = (Math.abs(netDelta).mul(uint128(spotPrice))) / 1e10;
        }

        {
            uint128 c;
            if (block.timestamp >= lastHedgeTime + 12 hours) {
                c = (uint128(block.timestamp) - lastHedgeTime - 12 hours) / 20 minutes;
                if (c > MAX_DRAWDOWN) c = MAX_DRAWDOWN;
            }
            if (isLong) {
                usdcAmount = (usdcAmount * (10000 + c)) / 10000;
            } else {
                usdcAmount = (usdcAmount * (10000 - c)) / 10000;
            }
        }

        // 3. Complete hedges for each pool
        {
            int256[2] memory deltas;
            deltas[0] = sqeethPoolDelta;
            deltas[1] = futurePoolDelta;
            nettingInfo.complete(NettingLib.CompleteParams(usdcAmount, underlyingAmount, deltas, spotPrice, isLong));
        }
    }

    /**
     * @notice Calculates ETH variance under the Exponentially Weighted Moving Average Model.
     */
    function updateVariance() external onlyPerpetualMarket {
        if (block.timestamp < poolSnapshot.lastSnapshotTime + 12 hours) {
            return;
        }
        (int256 spotPrice, ) = getUnderlyingPrice();

        // u_{t-1} = (S_t - S_{t-1}) / S_{t-1}
        int256 u = spotPrice.sub(poolSnapshot.ethPrice).mul(1e8).div(poolSnapshot.ethPrice);

        u = (u.mul(FUNDING_PERIOD)).div((block.timestamp - poolSnapshot.lastSnapshotTime).toInt256());

        // Updates snapshot
        // variance_{t} = λ * variance_{t-1} + (1 - λ) * u_{t-1}^2
        poolSnapshot.ethVariance = ((LAMBDA.mul(poolSnapshot.ethVariance).add(((1e8 - LAMBDA).mul(u.mul(u))) / 1e8)) /
            1e8).toInt128();
        poolSnapshot.ethPrice = spotPrice.toInt128();
        poolSnapshot.lastSnapshotTime = block.timestamp.toUint128();
    }

    /////////////////////////
    //  Getter Functions   //
    /////////////////////////

    /**
     * @notice get LP token price
     * LPTokenPrice = (UnrealizedPnL_sqeeth + UnrealizedPnL_future + L - lockedLiquidity_sqeeth - lockedLiquidity_future) / Supply
     * @return LPTokenPrice scaled by 1e6
     */
    function getLPTokenPrice() public view returns (uint256) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        return
            (
                (
                    uint256(
                        amountLiquidity.toInt256().add(
                            (getUnrealizedPnL(0, spotPrice).add(getUnrealizedPnL(1, spotPrice))) / 1e2
                        )
                    ).sub(pools[0].amountLockedLiquidity).sub(pools[1].amountLockedLiquidity)
                ).mul(1e6)
            ).div(supply);
    }

    /**
     * @notice get trade price
     * @param _productId product id
     * @param _tradeAmount size to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _productId, int128 _tradeAmount) external view returns (int256) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        return calculateTradePrice(_productId, spotPrice, _tradeAmount);
    }

    /**
     * @notice get utilization ratio
     * Utilization Ratio = (ΣamountLocked) / L
     * @return Utilization Ratio scaled by 1e6
     */
    function getUtilizationRatio() external view returns (uint256) {
        uint256 amountLocked;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            amountLocked = amountLocked.add(pools[i].amountLockedLiquidity);
        }

        return amountLocked.mul(1e6).div(amountLiquidity);
    }

    function getTradePriceInfo(int128[2] memory amountAssets) external view override returns (TradePriceInfo memory) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        int256[2] memory tradePrices;
        int128[2] memory cumFundingFeePerSizeGlobals;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            tradePrices[i] = calculateTradePrice(i, spotPrice, -amountAssets[i]);
            cumFundingFeePerSizeGlobals[i] = pools[i].amountFundingFeePerSize;
        }

        return TradePriceInfo(uint128(spotPrice), tradePrices, cumFundingFeePerSizeGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     * FundingPerSize = Price * FundingRate * (T-t) / 1 days
     */
    function executeFundingPayment(uint256 _productId, int256 _spotPrice) internal {
        if (pools[_productId].lastTradeTime == 0) {
            return;
        }

        int256 indexPrice = Pricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = getFundingRate(_productId);

        int256 fundingFeePerSize = ((indexPrice * currentFundingRate) / 1e8);

        fundingFeePerSize =
            (fundingFeePerSize * int128(uint128(block.timestamp) - pools[_productId].lastTradeTime)) /
            FUNDING_PERIOD;

        pools[_productId].amountFundingFeePerSize = pools[_productId]
            .amountFundingFeePerSize
            .add(fundingFeePerSize)
            .toInt128();

        int256 fundingReceived = (fundingFeePerSize * pools[_productId].amountAsset) / 1e10;

        amountLiquidity = Math.addDelta(amountLiquidity, fundingReceived);

        emit FundingPayment(_productId, currentFundingRate, fundingFeePerSize, fundingReceived);
    }

    /**
     * @notice Adds collateral to Netting contract
     */
    function addCollateral(uint256 _productId, int256 _spot) internal returns (int256, int256) {
        (int256 delta0, int256 delta1) = getDeltas(_spot, pools[0].amountAsset, pools[1].amountAsset);
        int256 gamma = (Pricer.calculateGamma(0).mul(pools[0].amountAsset)) / 1e8;

        return nettingInfo.addCollateral(_productId, NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot));
    }

    /**
     * @notice Gets Δm
     */
    function getReqiredCollateral(
        uint256 _productId,
        int256 _spot,
        int128 _tradeAmount
    ) internal view returns (int256) {
        int256 delta0;
        int256 delta1;
        int256 gamma;
        {
            int128 tradeAmount0;
            int128 tradeAmount1;

            if (_productId == 0) {
                tradeAmount0 += _tradeAmount;
            }

            if (_productId == 1) {
                tradeAmount1 += _tradeAmount;
            }

            (delta0, delta1) = getDeltas(_spot, tradeAmount0, tradeAmount1);
            gamma = (Pricer.calculateGamma(0).mul(tradeAmount0)) / 1e8;
        }

        NettingLib.AddCollateralParams memory params = NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot);

        int256 totalRequiredCollateral = NettingLib.getRequiredCollateral(_productId, params);

        int256 hedgePositionValue = nettingInfo.pools[_productId].getHedgePositionValue(params.spotPrice);

        return totalRequiredCollateral - hedgePositionValue;
    }

    /**
     * @notice Calculates pool's profit
     * @return poolProfit scaled by 1e6
     */
    function calculatePoolProfit(
        uint256 _productId,
        int256 _tradeAmount,
        int256 _deltaM,
        int256 _tradePrice,
        int256 _hedgePositionValue
    ) internal view returns (int256 poolProfit) {
        if (
            (_tradeAmount < 0 && pools[_productId].amountAsset.sub(_tradeAmount) > 0) ||
            (_tradeAmount > 0 && pools[_productId].amountAsset.sub(_tradeAmount) < 0)
        ) {
            // Δsize * (Price - valueEntry / tradeAmount)
            poolProfit =
                (
                    _tradeAmount.mul(
                        _tradePrice.sub(
                            pools[_productId].valueEntry.div((pools[_productId].amountAsset.sub(_tradeAmount)))
                        )
                    )
                ) /
                1e10;
        }

        if (_deltaM < 0) {
            // |Δm| * (1 - amountLockedLiquidity / HedgePositionValue)
            poolProfit = poolProfit.add(
                (
                    -_deltaM.mul(
                        int256(1e6).sub(
                            (int128(pools[_productId].amountLockedLiquidity).mul(1e8)).div(_hedgePositionValue)
                        )
                    )
                ) / 1e8
            );
        }
    }

    function calculateTradePrice(
        uint256 _productId,
        int256 _spotPrice,
        int128 _amountAsset
    ) internal view returns (int256) {
        int256 deltaM = getReqiredCollateral(_productId, _spotPrice, _amountAsset);

        return calculateTradePriceByDeltaCollateral(_productId, _spotPrice, deltaM);
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate + 0.5 * ΔFundingRate)
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePriceByDeltaCollateral(
        uint256 _productId,
        int256 _spotPrice,
        int256 _deltaM
    ) internal view returns (int256) {
        int256 indexPrice = Pricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = getFundingRate(_productId);

        int256 deltaFundingRate = getDeltaFundingRate(_productId, _deltaM);

        return ((indexPrice.mul(int256(1e8).add(currentFundingRate).add(deltaFundingRate / 2))) / 1e8).toInt128();
    }

    function getDeltas(
        int256 _spotPrice,
        int256 _tradeAmount0,
        int256 _tradeAmount1
    ) internal pure returns (int256, int256) {
        int256 sqeethPoolDelta = -(Pricer.calculateDelta(0, _spotPrice).mul(_tradeAmount0)) / 1e8;
        int256 futurePoolDelta = -(Pricer.calculateDelta(1, _spotPrice).mul(_tradeAmount1)) / 1e8;
        return (sqeethPoolDelta, futurePoolDelta);
    }

    /**
     * @notice Calculates Unrealized PnL
     * UnrealizedPnL = TradePrice * amountAsset - valueEntry + HedgePositionValue
     * @return UnrealizedPnL scaled by 1e8
     */
    function getUnrealizedPnL(uint256 _productId, int256 _spotPrice) internal view returns (int256) {
        int256 tradePrice = calculateTradePrice(_productId, _spotPrice, -pools[_productId].amountAsset);

        return
            (pools[_productId].valueEntry / 1e8).sub(tradePrice.mul(pools[_productId].amountAsset) / 1e8).add(
                nettingInfo.pools[_productId].getHedgePositionValue(_spotPrice)
            );
    }

    /**
     * @notice Calculates perpetual's funding rate
     * Sqeeth: FundingRate = variance * (1 + m / L)
     * Future: FundingRate = (m / L)
     * @return FundingRate scaled by 1e8 (1e8 = 100%)
     */
    function getFundingRate(uint256 _productId) internal view returns (int256) {
        int256 m = pools[_productId].amountLockedLiquidity.toInt256();
        // int128 m = NettingLib.getRequiredCollateral(_productId, NettingLib.AddCollateralParams()) / 1e2;

        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            if (liquidityAmountInt256 == 0) {
                return poolSnapshot.ethVariance;
            } else {
                return
                    ((poolSnapshot.ethVariance.mul((BETA_UR.mul(m)).div(liquidityAmountInt256).add(1e8))) / 1e8)
                        .toInt128();
            }
        } else if (_productId == 1) {
            if (pools[_productId].amountAsset > 0) {
                return ((MAX_FUNDING_RATE.mul(m)).div(liquidityAmountInt256)).toInt128();
            } else {
                return -((MAX_FUNDING_RATE.mul(m)).div(liquidityAmountInt256)).toInt128();
            }
        }
        return 0;
    }

    /**
     * @notice Calculates move of funding rate
     * Sqeeth: ΔFundingRate = variance * (m / L)
     * Future: ΔFundingRate = (m / L)
     * @return ΔFundingRate scaled by 1e8 (1e8 = 100%)
     */
    function getDeltaFundingRate(uint256 _productId, int256 _deltaM) internal view returns (int256) {
        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            return ((poolSnapshot.ethVariance.mul(BETA_UR).mul(_deltaM)).div(liquidityAmountInt256.mul(1e8)));
        } else if (_productId == 1) {
            return ((MAX_FUNDING_RATE.mul(_deltaM)).div(liquidityAmountInt256));
        }
        return 0;
    }

    /**
     * @notice get underlying price scaled by 1e8
     */
    function getUnderlyingPrice() internal view returns (int256, uint256) {
        (, int256 answer, , uint256 roundTimestamp, ) = priceFeed.latestRoundData();

        require(answer > 0, "PMC3");

        return (answer, roundTimestamp);
    }
}
