//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./lib/NettingLib.sol";
import "./lib/IndexPricer.sol";
import "./lib/SpreadLib.sol";
import "./lib/EntryPriceMath.sol";
import "./lib/PoolMath.sol";

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
contract PerpetualMarketCore is IPerpetualMarketCore, Ownable, ERC20 {
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

    // trade fee
    int256 private tradeFeeRate;

    // protocol fee
    int256 private protocolFeeRate;

    struct Pool {
        uint128 amountLockedLiquidity;
        int128 positionPerpetuals;
        uint128 entryPrice;
        int256 amountFundingPaidPerPosition;
        uint128 lastFundingPaymentTime;
    }

    struct PoolSnapshot {
        int128 futureBaseFundingRate;
        int128 ethVariance;
        int128 ethPrice;
        uint128 lastSnapshotTime;
    }

    enum MarginChange {
        ShortToShort,
        ShortToLong,
        LongToLong,
        LongToShort
    }

    // Total amount of liquidity provided by LPs
    uint256 public amountLiquidity;

    // Pools information storage
    mapping(uint256 => Pool) public pools;

    // Infos for spread calculation
    mapping(uint256 => SpreadLib.Info) private spreadInfos;

    // Infos for LPToken's spread calculation
    SpreadLib.Info private lpTokenSpreadInfo;

    // Snapshot of pool state at last ETH variance calculation
    PoolSnapshot public poolSnapshot;

    // Infos for collateral calculation
    NettingLib.Info private nettingInfo;

    // The address of Chainlink price feed
    AggregatorV3Interface private priceFeed;

    // The last spot price at heding
    int256 public lastHedgeSpotPrice;

    // The address of Perpetual Market Contract
    address private perpetualMarket;

    event FundingPayment(
        uint256 productId,
        int256 fundingRate,
        int256 amountFundingPaidPerPosition,
        int256 fundingPaidPerPosition,
        int256 poolReceived
    );
    event VarianceUpdated(int256 variance, int256 underlyingPrice, uint256 timestamp);

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

    constructor(
        address _priceFeedAddress,
        string memory _tokenName,
        string memory _tokenSymbol
    ) ERC20(_tokenName, _tokenSymbol) {
        // The decimals of LP token is 8
        _setupDecimals(8);

        priceFeed = AggregatorV3Interface(_priceFeedAddress);

        // initialize spread infos
        spreadInfos[0].init();
        spreadInfos[1].init();

        // 550%
        squaredPerpFundingMultiplier = 550 * 1e6;
        // 0.22%
        perpFutureMaxFundingRate = 22 * 1e4;
        // min slippage tolerance of a hedge is 0.4%
        minSlippageToleranceOfHedge = 40;
        // max slippage tolerance of a hedge is 0.8%
        maxSlippageToleranceOfHedge = 80;
        // rate of return threshold of a hedge is 2.5 %
        hedgeRateOfReturnThreshold = 25 * 1e5;
        // Pool collateral risk param is 40%
        poolMarginRiskParam = 4000;
        // Trade fee is 0.05%
        tradeFeeRate = 5 * 1e4;
        // Protocol fee is 0.02%
        protocolFeeRate = 2 * 1e4;
    }

    function setPerpetualMarket(address _perpetualMarket) external onlyOwner {
        require(perpetualMarket == address(0) && _perpetualMarket != address(0));
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice Initialize pool with initial liquidity and funding rate
     */
    function initialize(
        address _depositor,
        uint256 _depositAmount,
        int256 _initialFundingRate
    ) external override onlyPerpetualMarket returns (uint256 mintAmount) {
        require(totalSupply() == 0);
        mintAmount = _depositAmount;

        (int256 spotPrice, ) = getUnderlyingPrice();

        // initialize pool snapshot
        poolSnapshot.ethVariance = _initialFundingRate.toInt128();
        poolSnapshot.ethPrice = spotPrice.toInt128();
        poolSnapshot.lastSnapshotTime = block.timestamp.toUint128();

        // initialize last spot price at heding
        lastHedgeSpotPrice = spotPrice;

        amountLiquidity = amountLiquidity.add(_depositAmount);
        _mint(_depositor, mintAmount);
    }

    /**
     * @notice Provides liquidity
     */
    function deposit(address _depositor, uint256 _depositAmount)
        external
        override
        onlyPerpetualMarket
        returns (uint256 mintAmount)
    {
        require(totalSupply() > 0);

        uint256 lpTokenPrice = getLPTokenPrice(_depositAmount.toInt256());

        lpTokenPrice = lpTokenSpreadInfo.checkPrice(true, int256(lpTokenPrice)).toUint256();

        mintAmount = _depositAmount.mul(1e16).div(lpTokenPrice);

        amountLiquidity = amountLiquidity.add(_depositAmount);
        _mint(_depositor, mintAmount);
    }

    /**xx
     * @notice Withdraws liquidity
     */
    function withdraw(address _withdrawer, uint256 _withdrawnAmount)
        external
        override
        onlyPerpetualMarket
        returns (uint256 burnAmount)
    {
        require(getAvailableLiquidityAmount() >= _withdrawnAmount, "PMC0");

        uint256 lpTokenPrice = getLPTokenPrice(-_withdrawnAmount.toInt256());

        lpTokenPrice = lpTokenSpreadInfo.checkPrice(false, int256(lpTokenPrice)).toUint256();

        burnAmount = _withdrawnAmount.mul(1e16).div(lpTokenPrice);

        amountLiquidity = amountLiquidity.sub(_withdrawnAmount);
        _burn(_withdrawer, burnAmount);
    }

    function addLiquidity(uint256 _amount) external override onlyPerpetualMarket {
        amountLiquidity = amountLiquidity.add(_amount);
    }

    /**
     * @notice Adds or removes pool positions
     * @param _tradeAmounts amount of positions to trade.
     * positive for pool short and negative for pool long.
     */
    function updatePoolPositions(int256[2] memory _tradeAmounts)
        public
        override
        onlyPerpetualMarket
        returns (
            uint256[2] memory tradePrice,
            int256[2] memory fundingPaidPerPosition,
            uint256 protocolFee
        )
    {
        require(amountLiquidity > 0, "PMC1");

        int256 profitValue = 0;

        // Updates pool positions
        pools[0].positionPerpetuals = pools[0].positionPerpetuals.sub(_tradeAmounts[0]).toInt128();
        pools[1].positionPerpetuals = pools[1].positionPerpetuals.sub(_tradeAmounts[1]).toInt128();

        if (_tradeAmounts[0] != 0) {
            uint256 futureProtocolFee;
            int256 futureProfitValue;
            (tradePrice[0], fundingPaidPerPosition[0], futureProtocolFee, futureProfitValue) = updatePoolPosition(
                0,
                _tradeAmounts[0]
            );
            protocolFee = protocolFee.add(futureProtocolFee);
            profitValue = profitValue.add(futureProfitValue);
        }
        if (_tradeAmounts[1] != 0) {
            uint256 squaredProtocolFee;
            int256 squaredProfitValue;
            (tradePrice[1], fundingPaidPerPosition[1], squaredProtocolFee, squaredProfitValue) = updatePoolPosition(
                1,
                _tradeAmounts[1]
            );
            protocolFee = protocolFee.add(squaredProtocolFee);
            profitValue = profitValue.add(squaredProfitValue);
        }

        amountLiquidity = Math.addDelta(amountLiquidity, profitValue.sub(protocolFee.toInt256()));
    }

    /**
     * @notice Adds or removes pool position for a product
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _productId, int256 _tradeAmount)
        internal
        returns (
            uint256 tradePrice,
            int256,
            uint256 protocolFee,
            int256 profitValue
        )
    {
        (int256 spotPrice, ) = getUnderlyingPrice();

        // Calculate trade price
        (tradePrice, protocolFee) = calculateSafeTradePrice(_productId, spotPrice, _tradeAmount);

        {
            int256 newEntryPrice;
            (newEntryPrice, profitValue) = EntryPriceMath.updateEntryPrice(
                int256(pools[_productId].entryPrice),
                pools[_productId].positionPerpetuals.add(_tradeAmount),
                int256(tradePrice),
                -_tradeAmount
            );

            pools[_productId].entryPrice = newEntryPrice.toUint256().toUint128();
        }

        return (tradePrice, pools[_productId].amountFundingPaidPerPosition, protocolFee, profitValue);
    }

    /**
     * @notice Locks liquidity if more collateral required
     * and unlocks liquidity if there is unrequied collateral.
     */
    function rebalance() external override onlyPerpetualMarket {
        (int256 spotPrice, ) = getUnderlyingPrice();

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            int256 deltaMargin;
            int256 deltaLiquidity;

            {
                int256 hedgePositionValue;
                (deltaMargin, hedgePositionValue) = addMargin(i, spotPrice);

                (, deltaMargin, deltaLiquidity) = calculatePreTrade(
                    i,
                    deltaMargin,
                    hedgePositionValue,
                    MarginChange.LongToLong
                );
            }

            if (deltaLiquidity != 0) {
                amountLiquidity = Math.addDelta(amountLiquidity, deltaLiquidity);
            }
            if (deltaMargin != 0) {
                pools[i].amountLockedLiquidity = Math.addDelta(pools[i].amountLockedLiquidity, deltaMargin).toUint128();
            }
        }
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

        (int256 futurePoolDelta, int256 sqeethPoolDelta) = getDeltas(
            spotPrice,
            pools[0].positionPerpetuals,
            pools[1].positionPerpetuals
        );

        int256[2] memory deltas;

        deltas[0] = futurePoolDelta;
        deltas[1] = sqeethPoolDelta;

        completeParams = NettingLib.getRequiredTokenAmountsForHedge(nettingInfo.amountUnderlying, deltas, spotPrice);

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

    function getNettingInfo() external view returns (NettingLib.Info memory) {
        return nettingInfo;
    }

    /**
     * @notice Updates pool snapshot
     * Calculates ETH variance and base funding rate for future pool.
     */
    function updatePoolSnapshot() external override onlyPerpetualMarket {
        if (block.timestamp < poolSnapshot.lastSnapshotTime + 12 hours) {
            return;
        }

        updateVariance(block.timestamp);
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
    function updateVariance(uint256 _timestamp) internal {
        (int256 spotPrice, ) = getUnderlyingPrice();

        // u_{t-1} = (S_t - S_{t-1}) / S_{t-1}
        int256 u = spotPrice.sub(poolSnapshot.ethPrice).mul(1e8).div(poolSnapshot.ethPrice);

        int256 uPower2 = u.mul(u).div(1e8);

        // normalization
        uPower2 = (uPower2.mul(FUNDING_PERIOD)).div((_timestamp - poolSnapshot.lastSnapshotTime).toInt256());

        // Updates snapshot
        // variance_{t} = λ * variance_{t-1} + (1 - λ) * u_{t-1}^2
        poolSnapshot.ethVariance = ((LAMBDA.mul(poolSnapshot.ethVariance).add((1e8 - LAMBDA).mul(uPower2))) / 1e8)
            .toInt128();
        poolSnapshot.ethPrice = spotPrice.toInt128();
        poolSnapshot.lastSnapshotTime = _timestamp.toUint128();

        emit VarianceUpdated(poolSnapshot.ethVariance, poolSnapshot.ethPrice, _timestamp);
    }

    function updateBaseFundingRate() internal {
        poolSnapshot.futureBaseFundingRate = 0;
    }

    /////////////////////////
    //  Admin Functions    //
    /////////////////////////

    function setSquaredPerpFundingMultiplier(int256 _squaredPerpFundingMultiplier) external onlyOwner {
        require(_squaredPerpFundingMultiplier >= 0 && _squaredPerpFundingMultiplier <= 2000 * 1e6);
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

        int256 hedgePositionValue = nettingInfo.getTotalHedgePositionValue(spotPrice);

        return
            (
                (
                    uint256(amountLiquidity.toInt256().add(hedgePositionValue).add(unrealizedPnL))
                        .sub(pools[0].amountLockedLiquidity)
                        .sub(pools[1].amountLockedLiquidity)
                ).mul(1e16)
            ).div(totalSupply());
    }

    /**
     * @notice Gets trade price
     * @param _productId product id
     * @param _tradeAmounts amount of position to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _productId, int256[2] memory _tradeAmounts)
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

        return calculateTradePriceReadOnly(_productId, spotPrice, _tradeAmounts, 0);
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

    function getTradePriceInfo(int256[2] memory _tradeAmounts) external view override returns (TradePriceInfo memory) {
        (int256 spotPrice, ) = getUnderlyingPrice();

        int256[2] memory tradePrices;
        int256[2] memory fundingRates;
        int256[2] memory amountFundingPaidPerPositionGlobals;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            int256 indexPrice;
            (tradePrices[i], indexPrice, fundingRates[i], , ) = calculateTradePriceReadOnly(
                i,
                spotPrice,
                _tradeAmounts,
                0
            );

            // funding payments should be calculated from the current funding rate
            int256 currentFundingRate = getCurrentFundingRate(i);

            int256 fundingFeePerPosition = calculateFundingFeePerPosition(
                i,
                indexPrice,
                currentFundingRate,
                block.timestamp
            );

            amountFundingPaidPerPositionGlobals[i] = pools[i].amountFundingPaidPerPosition.add(fundingFeePerPosition);
        }

        return TradePriceInfo(uint128(spotPrice), tradePrices, fundingRates, amountFundingPaidPerPositionGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     */
    function _executeFundingPayment(uint256 _productId, int256 _spotPrice) internal {
        if (pools[_productId].lastFundingPaymentTime == 0) {
            // Initialize timestamp
            pools[_productId].lastFundingPaymentTime = uint128(block.timestamp);
            return;
        }

        if (block.timestamp <= pools[_productId].lastFundingPaymentTime) {
            return;
        }

        (
            int256 currentFundingRate,
            int256 fundingFeePerPosition,
            int256 fundingReceived
        ) = calculateResultOfFundingPayment(_productId, _spotPrice, block.timestamp);

        pools[_productId].amountFundingPaidPerPosition = pools[_productId].amountFundingPaidPerPosition.add(
            fundingFeePerPosition
        );

        if (fundingReceived != 0) {
            amountLiquidity = Math.addDelta(amountLiquidity, fundingReceived);
        }

        // Update last timestamp of funding payment
        pools[_productId].lastFundingPaymentTime = uint128(block.timestamp);

        emit FundingPayment(
            _productId,
            currentFundingRate,
            pools[_productId].amountFundingPaidPerPosition,
            fundingFeePerPosition,
            fundingReceived
        );
    }

    /**
     * @notice Calculates funding rate, funding fee per position and funding fee that the pool will receive.
     * @param _productId product id
     * @param _spotPrice current spot price for index calculation
     * @param _currentTimestamp the timestamp to execute funding payment
     */
    function calculateResultOfFundingPayment(
        uint256 _productId,
        int256 _spotPrice,
        uint256 _currentTimestamp
    )
        internal
        view
        returns (
            int256 currentFundingRate,
            int256 fundingFeePerPosition,
            int256 fundingReceived
        )
    {
        int256 indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        currentFundingRate = getCurrentFundingRate(_productId);

        fundingFeePerPosition = calculateFundingFeePerPosition(
            _productId,
            indexPrice,
            currentFundingRate,
            _currentTimestamp
        );

        // Pool receives 'FundingPaidPerPosition * -(Pool Positions)' USDC as funding fee.
        fundingReceived = (fundingFeePerPosition.mul(-pools[_productId].positionPerpetuals)).div(1e16);
    }

    /**
     * @notice Calculates amount of funding fee which long position should pay per position.
     * FundingPaidPerPosition = IndexPrice * FundingRate * (T-t) / 1 days
     * @param _productId product id
     * @param _indexPrice index price of the perpetual
     * @param _currentFundingRate current funding rate used to calculate funding fee
     * @param _currentTimestamp the timestamp to execute funding payment
     */
    function calculateFundingFeePerPosition(
        uint256 _productId,
        int256 _indexPrice,
        int256 _currentFundingRate,
        uint256 _currentTimestamp
    ) internal view returns (int256 fundingFeePerPosition) {
        fundingFeePerPosition = _indexPrice.mul(_currentFundingRate).div(1e8);

        // Normalization by FUNDING_PERIOD
        fundingFeePerPosition = (
            fundingFeePerPosition.mul(int256(_currentTimestamp.sub(pools[_productId].lastFundingPaymentTime)))
        ).div(FUNDING_PERIOD);
    }

    /**
     * @notice Gets current funding rate
     * @param _productId product id
     */
    function getCurrentFundingRate(uint256 _productId) internal view returns (int256) {
        return
            calculateFundingRate(
                _productId,
                getSignedMarginAmount(pools[_productId].positionPerpetuals, _productId),
                amountLiquidity.toInt256(),
                0,
                0
            );
    }

    /**
     * @notice Calculates signedDeltaMargin and changes of lockedLiquidity and totalLiquidity.
     * @return signedDeltaMargin is Δmargin: the change of the signed margin.
     * @return unlockLiquidityAmount is the change of the absolute amount of margin.
     * if return value is negative it represents unrequired.
     * @return deltaLiquidity Δliquidity: the change of the total liquidity amount.
     */
    function calculatePreTrade(
        uint256 _productId,
        int256 _deltaMargin,
        int256 _hedgePositionValue,
        MarginChange _marginChangeType
    )
        internal
        view
        returns (
            int256 signedDeltaMargin,
            int256 unlockLiquidityAmount,
            int256 deltaLiquidity
        )
    {
        if (_deltaMargin > 0) {
            if (_hedgePositionValue >= 0) {
                // In case of lock additional margin
                require(getAvailableLiquidityAmount() >= uint256(_deltaMargin), "PMC1");
                unlockLiquidityAmount = _deltaMargin;
            } else {
                // unlock all negative hedgePositionValue
                (deltaLiquidity, unlockLiquidityAmount) = (
                    _hedgePositionValue.sub(pools[_productId].amountLockedLiquidity.toInt256()),
                    -pools[_productId].amountLockedLiquidity.toInt256()
                );
                // lock additional margin
                require(getAvailableLiquidityAmount() >= uint256(_deltaMargin.add(_hedgePositionValue)), "PMC1");
                unlockLiquidityAmount = unlockLiquidityAmount.add(_deltaMargin.add(_hedgePositionValue));
            }
        } else if (_deltaMargin < 0) {
            // In case of unlock unrequired margin
            // _hedgePositionValue should be positive because _deltaMargin=RequiredMargin-_hedgePositionValue<0 => 0<RequiredMargin<_hedgePositionValue
            (deltaLiquidity, unlockLiquidityAmount) = calculateUnlockedLiquidity(
                pools[_productId].amountLockedLiquidity,
                _deltaMargin,
                _hedgePositionValue
            );
        }

        // Calculate signedDeltaMargin
        signedDeltaMargin = calculateSignedDeltaMargin(
            _marginChangeType,
            unlockLiquidityAmount,
            pools[_productId].amountLockedLiquidity
        );
    }

    /**
     * @notice Calculates trade price checked by spread manager
     * @return trade price and total protocol fee
     */
    function calculateSafeTradePrice(
        uint256 _productId,
        int256 _spotPrice,
        int256 _tradeAmount
    ) internal returns (uint256, uint256) {
        int256 deltaMargin;
        int256 signedDeltaMargin;
        int256 deltaLiquidity;
        {
            int256 hedgePositionValue;
            (deltaMargin, hedgePositionValue) = addMargin(_productId, _spotPrice);
            (signedDeltaMargin, deltaMargin, deltaLiquidity) = calculatePreTrade(
                _productId,
                deltaMargin,
                hedgePositionValue,
                getMarginChange(pools[_productId].positionPerpetuals, _tradeAmount)
            );
        }

        int256 signedMarginAmount = getSignedMarginAmount(
            // Calculate pool position before trade
            pools[_productId].positionPerpetuals.add(_tradeAmount),
            _productId
        );

        (int256 tradePrice, , , , int256 protocolFee) = calculateTradePrice(
            _productId,
            _spotPrice,
            _tradeAmount > 0,
            signedMarginAmount,
            amountLiquidity.toInt256(),
            signedDeltaMargin,
            deltaLiquidity
        );

        tradePrice = spreadInfos[_productId].checkPrice(_tradeAmount > 0, tradePrice);

        // Update pool liquidity and locked liquidity
        {
            if (deltaLiquidity != 0) {
                amountLiquidity = Math.addDelta(amountLiquidity, deltaLiquidity);
            }
            pools[_productId].amountLockedLiquidity = Math
                .addDelta(pools[_productId].amountLockedLiquidity, deltaMargin)
                .toUint128();
        }

        return (tradePrice.toUint256(), protocolFee.toUint256().mul(Math.abs(_tradeAmount)).div(1e8));
    }

    /**
     * @notice Calculates trade price as read-only trade.
     * @return tradePrice , indexPrice, fundingRate, tradeFee and protocolFee
     */
    function calculateTradePriceReadOnly(
        uint256 _productId,
        int256 _spotPrice,
        int256[2] memory _tradeAmounts,
        int256 _deltaLiquidity
    )
        internal
        view
        returns (
            int256 tradePrice,
            int256 indexPrice,
            int256 estFundingRate,
            int256 tradeFee,
            int256 protocolFee
        )
    {
        int256 signedDeltaMargin;

        if (_tradeAmounts[_productId] != 0) {
            (int256 deltaMargin, int256 hedgePositionValue, MarginChange marginChangeType) = getRequiredMargin(
                _productId,
                _spotPrice,
                _tradeAmounts
            );

            int256 deltaLiquidityByTrade;

            (signedDeltaMargin, , deltaLiquidityByTrade) = calculatePreTrade(
                _productId,
                deltaMargin,
                hedgePositionValue,
                marginChangeType
            );

            _deltaLiquidity = _deltaLiquidity.add(deltaLiquidityByTrade);
        }
        {
            int256 signedMarginAmount = getSignedMarginAmount(pools[_productId].positionPerpetuals, _productId);

            (tradePrice, indexPrice, , tradeFee, protocolFee) = calculateTradePrice(
                _productId,
                _spotPrice,
                _tradeAmounts[_productId] > 0,
                signedMarginAmount,
                amountLiquidity.toInt256(),
                signedDeltaMargin,
                _deltaLiquidity
            );

            // Calculate estimated funding rate
            estFundingRate = calculateFundingRate(
                _productId,
                signedMarginAmount.add(signedDeltaMargin),
                amountLiquidity.toInt256().add(_deltaLiquidity),
                0,
                0
            );
        }

        tradePrice = spreadInfos[_productId].getUpdatedPrice(
            _tradeAmounts[_productId] > 0,
            tradePrice,
            block.timestamp
        );

        return (tradePrice, indexPrice, estFundingRate, tradeFee, protocolFee);
    }

    /**
     * @notice Adds margin to Netting contract
     */
    function addMargin(uint256 _productId, int256 _spot)
        internal
        returns (int256 deltaMargin, int256 hedgePositionValue)
    {
        (int256 delta0, int256 delta1) = getDeltas(_spot, pools[0].positionPerpetuals, pools[1].positionPerpetuals);
        int256 gamma = (IndexPricer.calculateGamma(1).mul(pools[1].positionPerpetuals)) / 1e8;

        (deltaMargin, hedgePositionValue) = nettingInfo.addMargin(
            _productId,
            NettingLib.AddMarginParams(delta0, delta1, gamma, _spot, poolMarginRiskParam)
        );
    }

    /**
     * @notice Calculated required or unrequired margin for read-only price calculation.
     * @return deltaMargin is the change of the absolute amount of margin.
     * @return hedgePositionValue is current value of locked margin.
     * if return value is negative it represents unrequired.
     */
    function getRequiredMargin(
        uint256 _productId,
        int256 _spot,
        int256[2] memory _tradeAmounts
    )
        internal
        view
        returns (
            int256 deltaMargin,
            int256 hedgePositionValue,
            MarginChange marginChangeType
        )
    {
        int256 delta0;
        int256 delta1;
        int256 gamma;

        {
            int256 tradeAmount0 = pools[0].positionPerpetuals;
            int256 tradeAmount1 = pools[1].positionPerpetuals;

            tradeAmount0 = tradeAmount0.sub(_tradeAmounts[0]);
            tradeAmount1 = tradeAmount1.sub(_tradeAmounts[1]);

            if (_productId == 0) {
                marginChangeType = getMarginChange(tradeAmount0, _tradeAmounts[0]);
            }

            if (_productId == 1) {
                marginChangeType = getMarginChange(tradeAmount1, _tradeAmounts[1]);
            }

            (delta0, delta1) = getDeltas(_spot, tradeAmount0, tradeAmount1);
            gamma = (IndexPricer.calculateGamma(1).mul(tradeAmount1)) / 1e8;
        }

        NettingLib.AddMarginParams memory params = NettingLib.AddMarginParams(
            delta0,
            delta1,
            gamma,
            _spot,
            poolMarginRiskParam
        );

        int256 totalRequiredMargin = NettingLib.getRequiredMargin(_productId, params);

        hedgePositionValue = nettingInfo.getHedgePositionValue(params, _productId);

        deltaMargin = totalRequiredMargin.sub(hedgePositionValue);
    }

    /**
     * @notice Gets signed amount of margin used for trade price calculation.
     * @param _position current pool position
     * @param _productId product id
     * @return signedMargin is calculated by following rule.
     * If poolPosition is 0 then SignedMargin is 0.
     * If poolPosition is long then SignedMargin is negative.
     * If poolPosition is short then SignedMargin is positive.
     */
    function getSignedMarginAmount(int256 _position, uint256 _productId) internal view returns (int256) {
        if (_position == 0) {
            return 0;
        } else if (_position > 0) {
            return -pools[_productId].amountLockedLiquidity.toInt256();
        } else {
            return pools[_productId].amountLockedLiquidity.toInt256();
        }
    }

    /**
     * @notice Get signed delta margin. Signed delta margin is the change of the signed margin.
     * It is used for trade price calculation.
     * For example, if pool position becomes to short 10 from long 10 and deltaMargin hasn't changed.
     * Then deltaMargin should be 0 but signedDeltaMargin should be +20.
     * @param _deltaMargin amount of change in margin resulting from the trade
     * @param _currentMarginAmount amount of locked margin before trade
     * @return signedDeltaMargin is calculated by follows.
     * Crossing case:
     *   If position moves long to short then
     *     Δm = currentMarginAmount * 2 + deltaMargin
     *   If position moves short to long then
     *     Δm = -(currentMarginAmount * 2 + deltaMargin)
     * Non Crossing Case:
     *   If position moves long to long then
     *     Δm = -deltaMargin
     *   If position moves short to short then
     *     Δm = deltaMargin
     */
    function calculateSignedDeltaMargin(
        MarginChange _marginChangeType,
        int256 _deltaMargin,
        int256 _currentMarginAmount
    ) internal pure returns (int256) {
        if (_marginChangeType == MarginChange.LongToShort) {
            return _currentMarginAmount.mul(2).add(_deltaMargin);
        } else if (_marginChangeType == MarginChange.ShortToLong) {
            return -(_currentMarginAmount.mul(2).add(_deltaMargin));
        } else if (_marginChangeType == MarginChange.LongToLong) {
            return -_deltaMargin;
        } else {
            // In case of ShortToShort
            return _deltaMargin;
        }
    }

    /**
     * @notice Gets the type of margin change.
     * @param _newPosition positions resulting from trades
     * @param _positionTrade delta positions to trade
     * @return marginChange the type of margin change
     */
    function getMarginChange(int256 _newPosition, int256 _positionTrade) internal pure returns (MarginChange) {
        int256 position = _newPosition.add(_positionTrade);

        if (position > 0 && _newPosition < 0) {
            return MarginChange.LongToShort;
        } else if (position < 0 && _newPosition > 0) {
            return MarginChange.ShortToLong;
        } else if (position >= 0 && _newPosition >= 0) {
            return MarginChange.LongToLong;
        } else {
            return MarginChange.ShortToShort;
        }
    }

    /**
     * @notice Calculates delta liquidity amount and unlock liquidity amount
     * unlockLiquidityAmount = Δm * amountLockedLiquidity / hedgePositionValue
     * deltaLiquidity = Δm - UnlockAmount
     */
    function calculateUnlockedLiquidity(
        uint256 _amountLockedLiquidity,
        int256 _deltaMargin,
        int256 _hedgePositionValue
    ) internal pure returns (int256 deltaLiquidity, int256 unlockLiquidityAmount) {
        unlockLiquidityAmount = _deltaMargin.mul(_amountLockedLiquidity.toInt256()).div(_hedgePositionValue);

        return ((unlockLiquidityAmount.sub(_deltaMargin)), unlockLiquidityAmount);
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate) + TradeFee
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePrice(
        uint256 _productId,
        int256 _spotPrice,
        bool _isLong,
        int256 _margin,
        int256 _totalLiquidityAmount,
        int256 _deltaMargin,
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
        int256 fundingRate = calculateFundingRate(
            _productId,
            _margin,
            _totalLiquidityAmount,
            _deltaMargin,
            _deltaLiquidity
        );

        indexPrice = IndexPricer.calculateIndexPrice(_productId, _spotPrice);

        int256 tradePrice = (indexPrice.mul(int256(1e16).add(fundingRate))).div(1e16);

        tradeFee = getTradeFee(_productId, _isLong, indexPrice);

        tradePrice = tradePrice.add(tradeFee);

        protocolFee = getProtocolFee(_productId, indexPrice);

        return (tradePrice, indexPrice, fundingRate, Math.abs(tradeFee).toInt256(), protocolFee);
    }

    /**
     * @notice Gets trade fee
     * TradeFee = IndxPrice * tradeFeeRate
     */
    function getTradeFee(
        uint256 _productId,
        bool _isLong,
        int256 _indexPrice
    ) internal view returns (int256) {
        require(_indexPrice > 0);

        if (_isLong) {
            return _indexPrice.mul(tradeFeeRate).mul(int256(_productId + 1)) / 1e8;
        } else {
            return -_indexPrice.mul(tradeFeeRate).mul(int256(_productId + 1)) / 1e8;
        }
    }

    /**
     * @notice Gets protocol fee
     * ProtocolFee = IndxPrice * protocolFeeRate
     */
    function getProtocolFee(uint256 _productId, int256 _indexPrice) internal view returns (int256) {
        require(_indexPrice > 0);

        return _indexPrice.mul(protocolFeeRate).mul(int256(_productId + 1)) / 1e8;
    }

    function getDeltas(
        int256 _spotPrice,
        int256 _tradeAmount0,
        int256 _tradeAmount1
    ) internal pure returns (int256, int256) {
        int256 futurePoolDelta = (IndexPricer.calculateDelta(0, _spotPrice).mul(_tradeAmount0)) / 1e8;
        int256 sqeethPoolDelta = (IndexPricer.calculateDelta(1, _spotPrice).mul(_tradeAmount1)) / 1e8;
        return (futurePoolDelta, sqeethPoolDelta);
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
        int256[2] memory positionPerpetuals;

        positionPerpetuals[0] = pools[0].positionPerpetuals;
        positionPerpetuals[1] = pools[1].positionPerpetuals;

        if (pools[_productId].positionPerpetuals != 0) {
            (int256 tradePrice, , , , ) = calculateTradePriceReadOnly(
                _productId,
                _spotPrice,
                positionPerpetuals,
                _deltaLiquidityAmount
            );
            positionsValue =
                pools[_productId].positionPerpetuals.mul(tradePrice.sub(pools[_productId].entryPrice.toInt256())) /
                1e8;
        }

        return positionsValue;
    }

    /**
     * @notice Calculates perpetual's funding rate
     * Squared:
     *   FundingRate = variance * (1 + squaredPerpFundingMultiplier * m / L)
     * Future:
     *   FundingRate = BASE_FUNDING_RATE + perpFutureMaxFundingRate * (m / L)
     * @param _productId product id
     * @param _margin amount of locked margin before trade
     * @param _totalLiquidityAmount amount of total liquidity before trade
     * @param _deltaMargin amount of change in margin resulting from the trade
     * @param _deltaLiquidity difference of liquidity
     * @return FundingRate scaled by 1e16 (1e16 = 100%)
     */
    function calculateFundingRate(
        uint256 _productId,
        int256 _margin,
        int256 _totalLiquidityAmount,
        int256 _deltaMargin,
        int256 _deltaLiquidity
    ) internal view returns (int256) {
        if (_productId == 0) {
            int256 fundingRate = perpFutureMaxFundingRate
                .mul(
                    PoolMath.calculateMarginDivLiquidity(_margin, _deltaMargin, _totalLiquidityAmount, _deltaLiquidity)
                )
                .div(1e8);
            return poolSnapshot.futureBaseFundingRate.add(fundingRate);
        } else if (_productId == 1) {
            if (_totalLiquidityAmount == 0) {
                return poolSnapshot.ethVariance.mul(1e8);
            } else {
                int256 addition = squaredPerpFundingMultiplier
                    .mul(
                        PoolMath.calculateMarginDivLiquidity(
                            _margin,
                            _deltaMargin,
                            _totalLiquidityAmount,
                            _deltaLiquidity
                        )
                    )
                    .div(1e8);
                return poolSnapshot.ethVariance.mul(int256(1e16).add(addition)).div(1e8);
            }
        }
        return 0;
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
     * @notice Gets available amount of liquidity
     * available amount = amountLiquidity - (ΣamountLocked_i)
     */
    function getAvailableLiquidityAmount() internal view returns (uint256) {
        uint256 amountLocked;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            amountLocked = amountLocked.add(pools[i].amountLockedLiquidity);

            if (nettingInfo.amountsUsdc[i] < 0) {
                amountLocked = Math.addDelta(amountLocked, -nettingInfo.amountsUsdc[i]);
            }
        }

        return amountLiquidity.sub(amountLocked);
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
