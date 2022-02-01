//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./lib/NettingLib.sol";
import "./lib/IndexPricer.sol";
import "./lib/SpreadLib.sol";
import "./lib/EntryPriceMath.sol";
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

    // trade fee is 0.1%
    int256 private constant TRADE_FEE = 10 * 1e4;

    struct Pool {
        uint128 amountLockedLiquidity;
        int128 positionPerpetuals;
        uint128 entryPrice;
        int128 amountFundingFeePerPosition;
        uint128 lastTradeTime;
    }

    struct PoolSnapshot {
        int128 futureBaseFundingRate;
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

    // The address of Chainlink price feed
    AggregatorV3Interface private priceFeed;

    // The last timestamp of hedging
    uint128 public lastHedgeTime;

    // The address of Perpetual Market Contract
    address private perpetualMarket;

    event FundingPayment(uint256 productId, int256 fundingRate, int256 fundingPaidPerPosition, int256 poolReceived);

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

        mintAmount = _depositAmount.mul(1e8).div(getLPTokenPrice(_depositAmount.toInt256()));

        amountLiquidity = amountLiquidity.add(_depositAmount);
        supply = supply.add(mintAmount);
    }

    /**
     * @notice withdraw liquidity
     */
    function withdraw(uint128 _withdrawnAmount) external onlyPerpetualMarket returns (uint256 burnAmount) {
        require(
            amountLiquidity.sub(pools[0].amountLockedLiquidity).sub(pools[1].amountLockedLiquidity) >= _withdrawnAmount,
            "PMC0"
        );

        burnAmount = _withdrawnAmount.mul(1e8).div(getLPTokenPrice(-_withdrawnAmount.toInt256()));

        amountLiquidity = amountLiquidity.sub(_withdrawnAmount);
        supply = supply.sub(burnAmount);
    }

    function addLiquidity(uint128 _amount) external onlyPerpetualMarket {
        amountLiquidity = amountLiquidity.add(_amount);
    }

    /**
     * @notice add or remove positions
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _productId, int128 _tradeAmount)
        external
        onlyPerpetualMarket
        returns (uint256, int256)
    {
        require(amountLiquidity > 0, "PMC1");

        (int256 spotPrice, ) = getUnderlyingPrice();

        // Funding payment
        executeFundingPayment(_productId, spotPrice);

        // Updates pool position
        pools[_productId].positionPerpetuals -= _tradeAmount;

        // Add collateral to Netting contract
        (int256 deltaM, int256 hedgePositionValue) = addCollateral(_productId, spotPrice);

        // Calculate trade price
        int256 tradePrice = calculateTradePrice(_productId, spotPrice, _tradeAmount > 0, deltaM, 0);

        {
            // Calculate pool's new amountLiquidity
            int256 poolPofit = calculatePoolProfit(_productId, deltaM, hedgePositionValue);

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

        {
            (uint256 newEntryPrice, int256 profitValue) = EntryPriceMath.updateEntryPrice(
                pools[_productId].entryPrice,
                pools[_productId].positionPerpetuals.add(_tradeAmount),
                uint256(tradePrice),
                -_tradeAmount
            );

            pools[_productId].entryPrice = newEntryPrice.toUint128();

            amountLiquidity = Math.addDelta(amountLiquidity, profitValue / 1e2);
        }

        return (uint256(tradePrice), pools[_productId].amountFundingFeePerPosition.mul(_tradeAmount));
    }

    /**
     * @notice get USDC and underlying amount to make the pool delta neutral
     */
    function getTokenAmountForHedging() external view returns (NettingLib.CompleteParams memory completeParams) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        (int256 sqeethPoolDelta, int256 futurePoolDelta) = getDeltas(
            spotPrice,
            pools[0].positionPerpetuals,
            pools[1].positionPerpetuals
        );

        completeParams.deltas[0] = sqeethPoolDelta;
        completeParams.deltas[1] = futurePoolDelta;

        {
            // 1. Calculate net delta
            int256 netDelta = sqeethPoolDelta.add(futurePoolDelta).add(nettingInfo.getTotalUnderlyingPosition());

            completeParams.isLong = netDelta < 0;

            // 2. Calculate USDC and ETH amounts.
            completeParams.amountUnderlying = Math.abs(netDelta);
            completeParams.amountUsdc = (Math.abs(netDelta).mul(uint128(spotPrice))) / 1e8;
        }

        {
            uint128 c;
            if (block.timestamp >= lastHedgeTime + 12 hours) {
                c = (uint128(block.timestamp) - lastHedgeTime - 12 hours) / 20 minutes;
                if (c > MAX_DRAWDOWN) c = MAX_DRAWDOWN;
            }
            if (completeParams.isLong) {
                completeParams.amountUsdc = (completeParams.amountUsdc * (10000 + c)) / 10000;
            } else {
                completeParams.amountUsdc = (completeParams.amountUsdc * (10000 - c)) / 10000;
            }
        }
    }

    /**
     * @notice Calculates USDC amount and underlying amount for delta neutral
     * and store valueEntry price in netting info
     */
    function calculateEntryPriceForHedging(NettingLib.CompleteParams memory _completeParams)
        external
        onlyPerpetualMarket
    {
        // Complete hedges for each pool
        nettingInfo.complete(_completeParams);
    }

    /**
     * @notice update pool snapshot
     * Calculates ETH variance and base funding rate for future pool.
     */
    function updatePoolSnapshot() external onlyPerpetualMarket {
        if (block.timestamp < poolSnapshot.lastSnapshotTime + 12 hours) {
            return;
        }

        updateVariance();
        updateBaseFundingRate();
    }

    /**
     * @notice Calculates ETH variance under the Exponentially Weighted Moving Average Model.
     */
    function updateVariance() internal {
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

    function updateBaseFundingRate() internal {
        poolSnapshot.futureBaseFundingRate = 0;
    }

    /////////////////////////
    //  Getter Functions   //
    /////////////////////////

    /**
     * @notice get LP token price
     * LPTokenPrice = (UnrealizedPnL_sqeeth + UnrealizedPnL_future + L - lockedLiquidity_sqeeth - lockedLiquidity_future) / Supply
     * @return LPTokenPrice scaled by 1e8
     */
    function getLPTokenPrice(int256 _deltaLiquidityAmount) public view returns (uint256) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        int256 unrealizedPnL = (
            getUnrealizedPnL(0, spotPrice, _deltaLiquidityAmount).add(
                getUnrealizedPnL(1, spotPrice, _deltaLiquidityAmount)
            )
        ) / 1e2;

        return
            (
                (
                    uint256(amountLiquidity.toInt256().add(unrealizedPnL)).sub(pools[0].amountLockedLiquidity).sub(
                        pools[1].amountLockedLiquidity
                    )
                ).mul(1e8)
            ).div(supply);
    }

    /**
     * @notice get trade price
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _productId, int128 _tradeAmount) external view returns (int256) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        return calculateTradePriceReadOnly(_productId, spotPrice, _tradeAmount, 0);
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
        int128[2] memory cumFundingFeePerPositionGlobals;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            tradePrices[i] = calculateTradePriceReadOnly(i, spotPrice, -amountAssets[i], 0);
            cumFundingFeePerPositionGlobals[i] = pools[i].amountFundingFeePerPosition;
        }

        return TradePriceInfo(uint128(spotPrice), tradePrices, cumFundingFeePerPositionGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     * FundingPerPosition = Price * FundingRate * (T-t) / 1 days
     */
    function executeFundingPayment(uint256 _productId, int256 _spotPrice) internal {
        if (pools[_productId].lastTradeTime == 0) {
            return;
        }

        int256 indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = calculateFundingRate(_productId, 0, 0);

        int256 fundingFeePerPosition = ((indexPrice * currentFundingRate) / 1e8);

        fundingFeePerPosition =
            (fundingFeePerPosition * int128(uint128(block.timestamp) - pools[_productId].lastTradeTime)) /
            FUNDING_PERIOD;

        pools[_productId].amountFundingFeePerPosition = pools[_productId]
            .amountFundingFeePerPosition
            .add(fundingFeePerPosition)
            .toInt128();

        int256 fundingReceived = (fundingFeePerPosition.mul(-pools[_productId].positionPerpetuals)) / 1e10;

        amountLiquidity = Math.addDelta(amountLiquidity, fundingReceived);

        emit FundingPayment(_productId, currentFundingRate, fundingFeePerPosition, fundingReceived);
    }

    /**
     * @notice Adds collateral to Netting contract
     */
    function addCollateral(uint256 _productId, int256 _spot) internal returns (int256, int256) {
        (int256 delta0, int256 delta1) = getDeltas(_spot, pools[0].positionPerpetuals, pools[1].positionPerpetuals);
        int256 gamma = (IndexPricer.calculateGamma(0).mul(pools[0].positionPerpetuals)) / 1e8;

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
            int128 tradeAmount0 = pools[0].positionPerpetuals;
            int128 tradeAmount1 = pools[1].positionPerpetuals;

            if (_productId == 0) {
                tradeAmount0 -= _tradeAmount;
            }

            if (_productId == 1) {
                tradeAmount1 -= _tradeAmount;
            }

            (delta0, delta1) = getDeltas(_spot, tradeAmount0, tradeAmount1);
            gamma = (IndexPricer.calculateGamma(0).mul(tradeAmount0)) / 1e8;
        }

        NettingLib.AddCollateralParams memory params = NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot);

        int256 totalRequiredCollateral = NettingLib.getRequiredCollateral(_productId, params);

        int256 hedgePositionValue = nettingInfo.getHedgePositionValue(params.spotPrice, _productId);

        return totalRequiredCollateral - hedgePositionValue;
    }

    /**
     * @notice Calculates pool's profit
     * @return poolProfit scaled by 1e6
     */
    function calculatePoolProfit(
        uint256 _productId,
        int256 _deltaM,
        int256 _hedgePositionValue
    ) internal view returns (int256 poolProfit) {
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
        bool _isLong,
        int256 _deltaM,
        int256 _deltaLiquidity
    ) internal returns (int256) {
        int256 tradePrice = calculateTradePriceWithFundingRate(
            _productId,
            _spotPrice,
            _isLong,
            _deltaM,
            _deltaLiquidity
        );

        tradePrice = spreadInfos[_productId].checkPrice(_isLong, tradePrice);

        return tradePrice;
    }

    function calculateTradePriceReadOnly(
        uint256 _productId,
        int256 _spotPrice,
        int256 _tradeAmount,
        int256 _deltaLiquidity
    ) internal view returns (int256) {
        int256 deltaM = getReqiredCollateral(_productId, _spotPrice, _tradeAmount.toInt128());

        int256 tradePrice = calculateTradePriceWithFundingRate(
            _productId,
            _spotPrice,
            _tradeAmount > 0,
            deltaM,
            _deltaLiquidity
        );

        tradePrice = spreadInfos[_productId].getUpdatedPrice(_tradeAmount > 0, tradePrice, block.timestamp);

        return tradePrice;
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate)
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePriceWithFundingRate(
        uint256 _productId,
        int256 _spotPrice,
        bool _isLong,
        int256 _deltaM,
        int256 _deltaLiquidity
    ) internal view returns (int256) {
        int256 fundingFee = calculateFundingRate(_productId, _deltaM, _deltaLiquidity);

        int256 indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        int256 tradePrice = ((indexPrice.mul(int256(1e8).add(fundingFee))) / 1e8).toInt128();

        tradePrice = tradePrice + getTradeFee(_isLong, indexPrice);

        return tradePrice;
    }

    /**
     * @notice apply trade fee to trade price
     */
    function getTradeFee(bool _isLong, int256 _indexPrice) internal pure returns (int256) {
        require(_indexPrice > 0);

        if (_isLong) {
            return _indexPrice.mul(TRADE_FEE) / 1e8;
        } else {
            return -_indexPrice.mul(TRADE_FEE) / 1e8;
        }
    }

    function getDeltas(
        int256 _spotPrice,
        int256 _tradeAmount0,
        int256 _tradeAmount1
    ) internal pure returns (int256, int256) {
        int256 sqeethPoolDelta = (IndexPricer.calculateDelta(0, _spotPrice).mul(_tradeAmount0)) / 1e8;
        int256 futurePoolDelta = (IndexPricer.calculateDelta(1, _spotPrice).mul(_tradeAmount1)) / 1e8;
        return (sqeethPoolDelta, futurePoolDelta);
    }

    /**
     * @notice Calculates Unrealized PnL
     * UnrealizedPnL = valueEntry - TradePrice * positionPerpetuals + HedgePositionValue
     * TradePrice is calculated as fill price of closing all pool positions.
     * @return UnrealizedPnL scaled by 1e8
     */
    function getUnrealizedPnL(
        uint256 _productId,
        int256 _spotPrice,
        int256 _deltaLiquidityAmount
    ) internal view returns (int256) {
        int256 positionsValue;

        if (pools[_productId].positionPerpetuals != 0) {
            int256 tradePrice = calculateTradePriceReadOnly(
                _productId,
                _spotPrice,
                pools[_productId].positionPerpetuals,
                _deltaLiquidityAmount
            );
            positionsValue =
                pools[_productId].positionPerpetuals.mul(tradePrice.sub(pools[_productId].entryPrice.toInt256())) /
                1e8;
        }

        {
            int256 hedgePositionValue = nettingInfo.getHedgePositionValue(_spotPrice, _productId);

            positionsValue = positionsValue.add(hedgePositionValue);
        }

        return positionsValue;
    }

    /**
     * @notice Calculates perpetual's funding rate
     * Sqeeth: FundingRate = variance * (1 + BETA_UR * m / L)
     * Future: FundingRate = BASE_FUNDING_RATE + MAX_FUNDING_RATE * (m / L)
     * @param _productId product id
     * @param _deltaMargin difference of required margin
     * @param _deltaLiquidity difference of liquidity
     * @return FundingRate scaled by 1e8 (1e8 = 100%)
     */
    function calculateFundingRate(
        uint256 _productId,
        int256 _deltaMargin,
        int256 _deltaLiquidity
    ) internal view returns (int256) {
        int256 m = pools[_productId].amountLockedLiquidity.toInt256();
        // int128 m = NettingLib.getRequiredCollateral(_productId, NettingLib.AddCollateralParams()) / 1e2;

        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            if (liquidityAmountInt256 == 0) {
                return poolSnapshot.ethVariance;
            } else {
                return ((
                    poolSnapshot.ethVariance.mul(
                        (
                            BETA_UR.mul(
                                calculateMarginDivLiquidity(m, _deltaMargin, liquidityAmountInt256, _deltaLiquidity)
                            )
                        ).div(1e8).add(1e8)
                    )
                ) / 1e8);
            }
        } else if (_productId == 1) {
            int256 fundingRate;
            if (pools[_productId].positionPerpetuals > 0) {
                fundingRate = -MAX_FUNDING_RATE
                    .mul(calculateMarginDivLiquidity(m, _deltaMargin, liquidityAmountInt256, _deltaLiquidity))
                    .div(1e8);
            } else {
                fundingRate = MAX_FUNDING_RATE
                    .mul(calculateMarginDivLiquidity(m, _deltaMargin, liquidityAmountInt256, _deltaLiquidity))
                    .div(1e8);
            }
            return poolSnapshot.futureBaseFundingRate.add(fundingRate);
        }
        return 0;
    }

    /**
     * @notice calculate multiple integral of m/L
     * the formula is ((_m + _deltaM / 2) / _deltaL) * (log(_l + _deltaL) - log(_l))
     * @param _m required margin
     * @param _deltaM difference of required margin
     * @param _l total amount of liquidity
     * @param _deltaL difference of liquidity
     * @return returns result of above formula
     */
    function calculateMarginDivLiquidity(
        int256 _m,
        int256 _deltaM,
        int256 _l,
        int256 _deltaL
    ) internal pure returns (int256) {
        if (_deltaL == 0) {
            return (_m.add(_deltaM / 2).mul(1e8)).div(_l);
        } else {
            return (_m.add(_deltaM / 2)).mul(Math.logTaylor(_l.add(_deltaL)).sub(Math.logTaylor(_l))).div(_deltaL);
        }
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
