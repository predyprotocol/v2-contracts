//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./lib/NettingLib.sol";
import "./lib/IndexPricer.sol";
import "./lib/SpreadLib.sol";
import "./lib/EntryPriceMath.sol";

/**
 * @title PerpetualMarketCore
 * @notice Perpetual Market Core Contract manages perpetual pool positions and calculates amount of collaterals.
 * Error Code
 * PMC0: No available liquidity
 * PMC1: No available liquidity
 * PMC2: caller must be PerpetualMarket contract
 * PMC3: underlying price must not be 0
 * PMC4: pool delta must be negative
 * PMC5: invalid params
 */
contract PerpetualMarketCore is IPerpetualMarketCore, Ownable {
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

    // λ for exponentially weighted moving average is 94%
    int256 private constant LAMBDA = 94 * 1e6;

    // funding period is 1 days
    int256 private constant FUNDING_PERIOD = 1 days;

    // max ratio of (IV/RV)^2 for squeeth pool
    int256 private squaredPerpFundingMultiplier;

    // max funding rate of future pool
    int256 private perpFutureMaxFundingRate;

    // min slippage tolerance of a hedge
    uint256 private minSlippageToleranceOfHedge;

    // max slippage tolerance of a hedge
    uint256 private maxSlippageToleranceOfHedge;

    // rate of return threshold of a hedge
    uint256 private hedgeRateOfReturnThreshold;

    // allowable percentage of movement in the underlying spot price
    int256 private poolMarginRiskParam;

    // trade fee is 0.1%
    int256 private tradeFeeRate;

    // protocol fee is 0.04%
    int256 private protocolFeeRate;

    struct Pool {
        uint128 amountLockedLiquidity;
        int128 positionPerpetuals;
        uint128 entryPrice;
        int128 amountFundingPaidPerPosition;
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

    // The last spot price at heding
    int256 public lastHedgeSpotPrice;

    // The address of Perpetual Market Contract
    address private perpetualMarket;

    event FundingPayment(uint256 productId, int256 fundingRate, int256 fundingPaidPerPosition, int256 poolReceived);

    event SetSquaredPerpFundingMultiplier(int256 squaredPerpFundingMultiplier);
    event SetPerpFutureMaxFundingRate(int256 perpFutureMaxFundingRate);
    event SetHedgeParams(
        uint256 minSlippageToleranceOfHedge,
        uint256 maxSlippageToleranceOfHedge,
        uint256 hedgeRateOfReturnThreshold
    );
    event SetPoolMarginRiskParam(int256 poolMarginRiskParam);
    event SetTradeFeeRate(int256 tradeFeeRate, int256 protocolFeeRate);

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

        // 50%
        squaredPerpFundingMultiplier = 50 * 1e6;
        // 0.02%
        perpFutureMaxFundingRate = 2 * 1e4;
        // min slippage tolerance of a hedge is 0.4%
        minSlippageToleranceOfHedge = 40;
        // max slippage tolerance of a hedge is 0.8%
        maxSlippageToleranceOfHedge = 80;
        // rate of return threshold of a hedge is 2.5 %
        hedgeRateOfReturnThreshold = 25 * 1e5;
        // Pool collateral risk param is 40%
        poolMarginRiskParam = 4000;
        // Trade fee is 0.1%
        tradeFeeRate = 10 * 1e4;
        // Protocol fee is 0.04%
        protocolFeeRate = 4 * 1e4;
    }

    function setPerpetualMarket(address _perpetualMarket) external onlyPerpetualMarket {
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice Initialize pool with initial liquidity and funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate)
        external
        override
        onlyPerpetualMarket
        returns (uint128 mintAmount)
    {
        require(supply == 0);
        mintAmount = _depositAmount;

        (int256 spotPrice, ) = getUnderlyingPrice();

        // initialize pool snapshot
        poolSnapshot.ethVariance = _initialFundingRate;
        poolSnapshot.ethPrice = spotPrice.toInt128();
        poolSnapshot.lastSnapshotTime = block.timestamp.toUint128();

        // initialize last spot price at heding
        lastHedgeSpotPrice = spotPrice;

        amountLiquidity = amountLiquidity.add(_depositAmount);
        supply = supply.add(mintAmount);
    }

    /**
     * @notice Provides liquidity
     */
    function deposit(uint128 _depositAmount) external override onlyPerpetualMarket returns (uint256 mintAmount) {
        require(supply > 0);

        mintAmount = _depositAmount.mul(1e16).div(getLPTokenPrice(_depositAmount.toInt256()));

        amountLiquidity = amountLiquidity.add(_depositAmount);
        supply = supply.add(mintAmount);
    }

    /**
     * @notice Withdraws liquidity
     */
    function withdraw(uint128 _withdrawnAmount) external override onlyPerpetualMarket returns (uint256 burnAmount) {
        require(
            amountLiquidity.sub(pools[0].amountLockedLiquidity).sub(pools[1].amountLockedLiquidity) >= _withdrawnAmount,
            "PMC0"
        );

        burnAmount = _withdrawnAmount.mul(1e16).div(getLPTokenPrice(-_withdrawnAmount.toInt256()));

        amountLiquidity = amountLiquidity.sub(_withdrawnAmount);
        supply = supply.sub(burnAmount);
    }

    function addLiquidity(uint256 _amount) external override onlyPerpetualMarket {
        amountLiquidity = amountLiquidity.add(_amount);
    }

    /**
     * @notice Adds or removes positions
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _productId, int128 _tradeAmount)
        external
        override
        onlyPerpetualMarket
        returns (
            uint256 tradePrice,
            int256,
            uint256 protocolFee
        )
    {
        require(amountLiquidity > 0, "PMC1");

        (int256 spotPrice, ) = getUnderlyingPrice();

        // Funding payment
        _executeFundingPayment(_productId, spotPrice);

        // Updates pool position
        pools[_productId].positionPerpetuals -= _tradeAmount;

        // Add collateral to Netting contract
        (int256 deltaM, int256 hedgePositionValue) = addMargin(_productId, spotPrice);

        // Calculate trade price
        (tradePrice, protocolFee) = calculateTradePrice(_productId, spotPrice, _tradeAmount > 0, deltaM, 0);

        protocolFee = protocolFee.mul(Math.abs(_tradeAmount)).div(1e8);

        {
            // Calculate pool's new amountLiquidity

            // Updates locked liquidity amount
            if (deltaM > 0) {
                require(amountLiquidity.sub(pools[_productId].amountLockedLiquidity) >= uint128(deltaM), "PMC1");
                pools[_productId].amountLockedLiquidity = pools[_productId]
                    .amountLockedLiquidity
                    .add(uint128(deltaM))
                    .toUint128();
            } else if (deltaM < 0) {
                // Calculate new amounts of liquidity and locked liquidity
                (amountLiquidity, pools[_productId].amountLockedLiquidity) = calculateUnlockedLiquidity(
                    amountLiquidity,
                    pools[_productId].amountLockedLiquidity,
                    uint256(-deltaM),
                    hedgePositionValue
                );
            }
        }

        // Update trade time
        pools[_productId].lastTradeTime = uint128(block.timestamp);

        {
            (int256 newEntryPrice, int256 profitValue) = EntryPriceMath.updateEntryPrice(
                int256(pools[_productId].entryPrice),
                pools[_productId].positionPerpetuals.add(_tradeAmount),
                int256(tradePrice),
                -_tradeAmount
            );

            pools[_productId].entryPrice = newEntryPrice.toUint256().toUint128();

            amountLiquidity = Math.addDelta(amountLiquidity, profitValue - protocolFee.toInt256());
        }

        return (tradePrice, pools[_productId].amountFundingPaidPerPosition, protocolFee);
    }

    /**
     * @notice Gets USDC and underlying amount to make the pool delta neutral
     */
    function getTokenAmountForHedging()
        external
        view
        override
        returns (NettingLib.CompleteParams memory completeParams)
    {
        (int256 spotPrice, ) = getUnderlyingPrice();

        (int256 sqeethPoolDelta, int256 futurePoolDelta) = getDeltas(
            spotPrice,
            pools[0].positionPerpetuals,
            pools[1].positionPerpetuals
        );

        int256[2] memory deltas;

        deltas[0] = sqeethPoolDelta;
        deltas[1] = futurePoolDelta;

        completeParams = NettingLib.getRequiredTokenAmountsForHedge(nettingInfo.amountsUnderlying, deltas, spotPrice);

        uint256 slippageTolerance = calculateSlippageToleranceForHedging(spotPrice);

        if (completeParams.isLong) {
            completeParams.amountUsdc = (completeParams.amountUsdc.mul(uint256(10000).add(slippageTolerance))).div(
                10000
            );
        } else {
            completeParams.amountUsdc = (completeParams.amountUsdc.mul(uint256(10000).sub(slippageTolerance))).div(
                10000
            );
        }
    }

    /**
     * @notice Update netting info to complete heging procedure
     */
    function completeHedgingProcedure(NettingLib.CompleteParams memory _completeParams)
        external
        override
        onlyPerpetualMarket
    {
        (int256 spotPrice, ) = getUnderlyingPrice();

        lastHedgeSpotPrice = spotPrice;

        nettingInfo.complete(_completeParams);
    }

    /**
     * @notice Updates pool snapshot
     * Calculates ETH variance and base funding rate for future pool.
     */
    function updatePoolSnapshot() external override onlyPerpetualMarket {
        if (block.timestamp < poolSnapshot.lastSnapshotTime + 12 hours) {
            return;
        }

        updateVariance();
        updateBaseFundingRate();
    }

    function executeFundingPayment() external override onlyPerpetualMarket {
        (int256 spotPrice, ) = getUnderlyingPrice();

        // Funding payment
        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            _executeFundingPayment(i, spotPrice);
        }
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
    //  Admin Functions    //
    /////////////////////////

    function setSquaredPerpFundingMultiplier(int256 _squaredPerpFundingMultiplier) external onlyOwner {
        require(_squaredPerpFundingMultiplier >= 0 && _squaredPerpFundingMultiplier <= 200 * 1e6);
        squaredPerpFundingMultiplier = _squaredPerpFundingMultiplier;
        emit SetSquaredPerpFundingMultiplier(_squaredPerpFundingMultiplier);
    }

    function setPerpFutureMaxFundingRate(int256 _perpFutureMaxFundingRate) external onlyOwner {
        require(_perpFutureMaxFundingRate >= 0 && _perpFutureMaxFundingRate <= 1 * 1e6);
        perpFutureMaxFundingRate = _perpFutureMaxFundingRate;
        emit SetPerpFutureMaxFundingRate(_perpFutureMaxFundingRate);
    }

    function setHedgeParams(
        uint256 _minSlippageToleranceOfHedge,
        uint256 _maxSlippageToleranceOfHedge,
        uint256 _hedgeRateOfReturnThreshold
    ) external onlyOwner {
        require(
            _minSlippageToleranceOfHedge >= 0 && _maxSlippageToleranceOfHedge >= 0 && _hedgeRateOfReturnThreshold >= 0
        );
        require(
            _minSlippageToleranceOfHedge < _maxSlippageToleranceOfHedge && _maxSlippageToleranceOfHedge <= 200,
            "PMC5"
        );

        minSlippageToleranceOfHedge = _minSlippageToleranceOfHedge;
        maxSlippageToleranceOfHedge = _maxSlippageToleranceOfHedge;
        hedgeRateOfReturnThreshold = _hedgeRateOfReturnThreshold;
        emit SetHedgeParams(_minSlippageToleranceOfHedge, _maxSlippageToleranceOfHedge, _hedgeRateOfReturnThreshold);
    }

    function setPoolMarginRiskParam(int256 _poolMarginRiskParam) external onlyOwner {
        require(_poolMarginRiskParam >= 0);
        poolMarginRiskParam = _poolMarginRiskParam;
        emit SetPoolMarginRiskParam(_poolMarginRiskParam);
    }

    function setTradeFeeRate(int256 _tradeFeeRate, int256 _protocolFeeRate) external onlyOwner {
        require(0 <= _protocolFeeRate && _tradeFeeRate <= 30 * 1e4 && _protocolFeeRate < _tradeFeeRate, "PMC5");
        tradeFeeRate = _tradeFeeRate;
        protocolFeeRate = _protocolFeeRate;
        emit SetTradeFeeRate(_tradeFeeRate, _protocolFeeRate);
    }

    /////////////////////////
    //  Getter Functions   //
    /////////////////////////

    /**
     * @notice Gets LP token price
     * LPTokenPrice = (L + ΣUnrealizedPnL_i - ΣAmountLockedLiquidity_i) / Supply
     * @return LPTokenPrice scaled by 1e16
     */
    function getLPTokenPrice(int256 _deltaLiquidityAmount) public view override returns (uint256) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        int256 unrealizedPnL = (
            getUnrealizedPnL(0, spotPrice, _deltaLiquidityAmount).add(
                getUnrealizedPnL(1, spotPrice, _deltaLiquidityAmount)
            )
        );

        return
            (
                (
                    uint256(amountLiquidity.toInt256().add(unrealizedPnL)).sub(pools[0].amountLockedLiquidity).sub(
                        pools[1].amountLockedLiquidity
                    )
                ).mul(1e16)
            ).div(supply);
    }

    /**
     * @notice Gets trade price
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _productId, int128 _tradeAmount)
        external
        view
        override
        returns (
            int256,
            int256,
            int256,
            int256,
            int256
        )
    {
        (int256 spotPrice, ) = getUnderlyingPrice();

        return calculateTradePriceReadOnly(_productId, spotPrice, _tradeAmount, 0);
    }

    /**
     * @notice Gets utilization ratio
     * Utilization Ratio = (ΣAmountLockedLiquidity_i) / L
     * @return Utilization Ratio scaled by 1e8
     */
    function getUtilizationRatio() external view returns (uint256) {
        uint256 amountLocked;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            amountLocked = amountLocked.add(pools[i].amountLockedLiquidity);
        }

        return amountLocked.mul(1e8).div(amountLiquidity);
    }

    function getTradePriceInfo(int128[2] memory amountAssets) external view override returns (TradePriceInfo memory) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        int256[2] memory tradePrices;
        int128[2] memory amountFundingPaidPerPositionGlobals;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            int256 indexPrice;
            int256 fundingRate;
            (tradePrices[i], indexPrice, fundingRate, , ) = calculateTradePriceReadOnly(
                i,
                spotPrice,
                -amountAssets[i],
                0
            );

            int256 fundingFeePerPosition = (indexPrice.mul(fundingRate)) / 1e8;

            fundingFeePerPosition = (fundingFeePerPosition.mul(int256(block.timestamp.sub(pools[i].lastTradeTime))))
                .div(FUNDING_PERIOD);

            amountFundingPaidPerPositionGlobals[i] = pools[i]
                .amountFundingPaidPerPosition
                .add(fundingFeePerPosition)
                .toInt128();
        }

        return TradePriceInfo(uint128(spotPrice), tradePrices, amountFundingPaidPerPositionGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     * FundingPaidPerPosition = Price * FundingRate * (T-t) / 1 days
     * FundingPaidPerPosition is the cumulative funding fee paid by long per position.
     */
    function _executeFundingPayment(uint256 _productId, int256 _spotPrice) internal {
        if (pools[_productId].lastTradeTime == 0) {
            return;
        }

        if (block.timestamp <= pools[_productId].lastTradeTime) {
            return;
        }

        int256 indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = calculateFundingRate(_productId, 0, 0);

        int256 fundingFeePerPosition = indexPrice.mul(currentFundingRate) / 1e8;

        fundingFeePerPosition = (
            fundingFeePerPosition.mul(int256(block.timestamp.sub(pools[_productId].lastTradeTime)))
        ).div(FUNDING_PERIOD);

        pools[_productId].amountFundingPaidPerPosition = pools[_productId]
            .amountFundingPaidPerPosition
            .add(fundingFeePerPosition)
            .toInt128();

        int256 fundingReceived = (fundingFeePerPosition.mul(-pools[_productId].positionPerpetuals)) / 1e8;

        amountLiquidity = Math.addDelta(amountLiquidity, fundingReceived);

        emit FundingPayment(_productId, currentFundingRate, fundingFeePerPosition, fundingReceived);
    }

    /**
     * @notice Adds margin to Netting contract
     */
    function addMargin(uint256 _productId, int256 _spot) internal returns (int256, int256) {
        (int256 delta0, int256 delta1) = getDeltas(_spot, pools[0].positionPerpetuals, pools[1].positionPerpetuals);
        int256 gamma = (IndexPricer.calculateGamma(0).mul(pools[0].positionPerpetuals)) / 1e8;

        return
            nettingInfo.addMargin(
                _productId,
                NettingLib.AddMarginParams(delta0, delta1, gamma, _spot, poolMarginRiskParam)
            );
    }

    /**
     * @notice Gets Δm
     */
    function getReqiredMargin(
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

        NettingLib.AddMarginParams memory params = NettingLib.AddMarginParams(
            delta0,
            delta1,
            gamma,
            _spot,
            poolMarginRiskParam
        );

        int256 totalRequiredMargin = NettingLib.getRequiredMargin(_productId, params);

        int256 hedgePositionValue = nettingInfo.getHedgePositionValue(params.spotPrice, _productId);

        return totalRequiredMargin - hedgePositionValue;
    }

    /**
     * @notice Calculates new amounts of liquidity and locked liquidity
     * UnlockAmount = Δm * amountLockedLiquidity / hedgePositionValue
     * amountLockedLiquidity <- amountLockedLiquidity - UnlockAmount
     * amountLiquidity <- amountLiquidity + Δm - UnlockAmount
     */
    function calculateUnlockedLiquidity(
        uint256 _amountLiquidity,
        uint256 _amountLockedLiquidity,
        uint256 _deltaM,
        int256 _hedgePositionValue
    ) internal pure returns (uint128 newAmountLiquidity, uint128 newLockedLiquidity) {
        uint256 unlockAmount = _deltaM.mul(_amountLockedLiquidity).div(_hedgePositionValue.toUint256());

        newLockedLiquidity = _amountLockedLiquidity.sub(unlockAmount).toUint128();

        newAmountLiquidity = Math.addDelta(_amountLiquidity, int256(_deltaM) - int256(unlockAmount)).toUint128();
    }

    /**
     * @notice Calculates trade price
     * @return trade price and protocol fee
     */
    function calculateTradePrice(
        uint256 _productId,
        int256 _spotPrice,
        bool _isLong,
        int256 _deltaM,
        int256 _deltaLiquidity
    ) internal returns (uint256, uint256) {
        (int256 tradePrice, , , , int256 protocolFee) = calculateTradePriceWithFundingRate(
            _productId,
            _spotPrice,
            _isLong,
            _deltaM,
            _deltaLiquidity
        );

        tradePrice = spreadInfos[_productId].checkPrice(_isLong, tradePrice);

        return (tradePrice.toUint256(), protocolFee.toUint256());
    }

    /**
     * @notice Calculates trade price
     * @return tradePrice , indexPrice, fundingRate, tradeFee and protocolFee
     */
    function calculateTradePriceReadOnly(
        uint256 _productId,
        int256 _spotPrice,
        int256 _tradeAmount,
        int256 _deltaLiquidity
    )
        internal
        view
        returns (
            int256 tradePrice,
            int256 indexPrice,
            int256 fundingRate,
            int256 tradeFee,
            int256 protocolFee
        )
    {
        int256 deltaM = getReqiredMargin(_productId, _spotPrice, _tradeAmount.toInt128());

        (tradePrice, indexPrice, fundingRate, tradeFee, protocolFee) = calculateTradePriceWithFundingRate(
            _productId,
            _spotPrice,
            _tradeAmount > 0,
            deltaM,
            _deltaLiquidity
        );

        tradePrice = spreadInfos[_productId].getUpdatedPrice(_tradeAmount > 0, tradePrice, block.timestamp);

        return (tradePrice, indexPrice, fundingRate, tradeFee, protocolFee);
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate) + TradeFee
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePriceWithFundingRate(
        uint256 _productId,
        int256 _spotPrice,
        bool _isLong,
        int256 _deltaM,
        int256 _deltaLiquidity
    )
        internal
        view
        returns (
            int256,
            int256 indexPrice,
            int256,
            int256 tradeFee,
            int256 protocolFee
        )
    {
        int256 fundingRate = calculateFundingRate(_productId, _deltaM, _deltaLiquidity);

        indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        int256 tradePrice = ((indexPrice.mul(int256(1e8).add(fundingRate))) / 1e8).toInt128();

        tradeFee = getTradeFee(_isLong, indexPrice);

        tradePrice = tradePrice.add(tradeFee);

        protocolFee = getProtocolFee(indexPrice);

        return (tradePrice, indexPrice, fundingRate, tradeFee, protocolFee);
    }

    /**
     * @notice Gets trade fee
     * TradeFee = IndxPrice * tradeFeeRate
     */
    function getTradeFee(bool _isLong, int256 _indexPrice) internal view returns (int256) {
        require(_indexPrice > 0);

        if (_isLong) {
            return _indexPrice.mul(tradeFeeRate) / 1e8;
        } else {
            return -_indexPrice.mul(tradeFeeRate) / 1e8;
        }
    }

    /**
     * @notice Gets protocol fee
     * ProtocolFee = IndxPrice * protocolFeeRate
     */
    function getProtocolFee(int256 _indexPrice) internal view returns (int256) {
        require(_indexPrice > 0);

        return _indexPrice.mul(protocolFeeRate) / 1e8;
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
     * UnrealizedPnL = (TradePrice - EntryPrice) * Position_i + HedgePositionValue
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
            (int256 tradePrice, , , , ) = calculateTradePriceReadOnly(
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
     * Squeeth: FundingRate = variance * (1 + squaredPerpFundingMultiplier * m / L)
     * Future: FundingRate = BASE_FUNDING_RATE + perpFutureMaxFundingRate * (m / L)
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

        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            if (liquidityAmountInt256 == 0) {
                return poolSnapshot.ethVariance;
            } else {
                return ((
                    poolSnapshot.ethVariance.mul(
                        (
                            squaredPerpFundingMultiplier.mul(
                                calculateMarginDivLiquidity(m, _deltaMargin, liquidityAmountInt256, _deltaLiquidity)
                            )
                        ).div(1e8).add(1e8)
                    )
                ) / 1e8);
            }
        } else if (_productId == 1) {
            int256 fundingRate;
            if (pools[_productId].positionPerpetuals > 0) {
                fundingRate = -perpFutureMaxFundingRate
                    .mul(calculateMarginDivLiquidity(m, _deltaMargin, liquidityAmountInt256, _deltaLiquidity))
                    .div(1e8);
            } else {
                fundingRate = perpFutureMaxFundingRate
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
     * @notice Calculates the slippage tolerance of USDC amount for a hedge
     */
    function calculateSlippageToleranceForHedging(int256 _spotPrice) internal view returns (uint256 slippageTolerance) {
        uint256 rateOfReturn = Math.abs(_spotPrice.sub(lastHedgeSpotPrice).mul(1e8).div(lastHedgeSpotPrice));

        slippageTolerance = minSlippageToleranceOfHedge.add(
            (maxSlippageToleranceOfHedge - minSlippageToleranceOfHedge).mul(rateOfReturn).div(
                hedgeRateOfReturnThreshold
            )
        );

        if (slippageTolerance < minSlippageToleranceOfHedge) slippageTolerance = minSlippageToleranceOfHedge;
        if (slippageTolerance > maxSlippageToleranceOfHedge) slippageTolerance = maxSlippageToleranceOfHedge;
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
