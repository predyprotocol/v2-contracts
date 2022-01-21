//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
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
 */
contract PerpetualMarketCore is IPerpetualMarketCore {
    using NettingLib for NettingLib.Info;
    using NettingLib for NettingLib.PoolInfo;
    using SpreadLib for SpreadLib.Info;

    uint256 private constant MAX_POOL_ID = 2;

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
        // amount of locked liquidity
        uint128 lockedLiquidityAmount;
        // position size
        int128 size;
        // entry price
        int128 entryPrice;
        // cumulated funding fee per size
        int128 cumulativeFundingFeePerSizeGlobal;
        // timestamp of last trade
        uint128 lastTradeTime;
    }

    // snapshot of pool state at last variance calculation
    struct PoolSnapshot {
        int128 deltaImpact;
        // estimated variance of ETH
        int128 variance;
        // ETH price
        int128 ethPrice;
        // timestamp of last variance calculation
        uint128 lastTimestamp;
    }

    uint128 public supply;

    uint128 public liquidityAmount;

    mapping(uint256 => Pool) public pools;

    mapping(uint256 => SpreadLib.Info) private spreadInfos;

    PoolSnapshot private poolSnapshot;

    NettingLib.Info private nettingInfo;

    AggregatorV3Interface private priceFeed;

    uint128 public lastHedgeTime;

    address private perpetualMarket;

    modifier onlyPerpetualMarket() {
        require(msg.sender == perpetualMarket);
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

        (uint128 spot, ) = getUnderlyingPrice();

        poolSnapshot.variance = _initialFundingRate;
        poolSnapshot.ethPrice = int128(spot);
        poolSnapshot.lastTimestamp = uint128(block.timestamp);

        liquidityAmount += _depositAmount;
        supply += mintAmount;
    }

    /**
     * @notice provide liquidity
     */
    function deposit(uint128 _depositAmount) external onlyPerpetualMarket returns (uint128 mintAmount) {
        require(supply > 0);

        mintAmount = (1e6 * _depositAmount) / getLPTokenPrice();

        liquidityAmount += _depositAmount;
        supply += mintAmount;
    }

    /**
     * @notice withdraw liquidity
     */
    function withdraw(uint128 _withdrawnAmount) external onlyPerpetualMarket returns (uint128 burnAmount) {
        burnAmount = (1e6 * _withdrawnAmount) / getLPTokenPrice();

        require(
            liquidityAmount - pools[0].lockedLiquidityAmount - pools[1].lockedLiquidityAmount >= _withdrawnAmount,
            "PMC0"
        );

        liquidityAmount -= _withdrawnAmount;
        supply -= burnAmount;
    }

    function addLiquidity(uint128 _amount) external onlyPerpetualMarket {
        liquidityAmount += _amount;
    }

    /**
     * @notice add or remove positions
     * @param _poolId pool id
     * @param _size size to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _poolId, int128 _size) external onlyPerpetualMarket returns (int128, int128) {
        (uint128 spot, ) = getUnderlyingPrice();

        // Funding payment
        executeFundingPayment(_poolId, spot);

        // Updates position size
        pools[_poolId].size += _size;

        // Add collateral to Netting contract
        (int128 deltaM, int128 hedgePositionValue) = addCollateral(_poolId, spot);

        // Calculate trade price
        int128 tradePrice = int128(calculateTradePrice(_poolId, spot, deltaM));

        // Manages spread
        tradePrice = spreadInfos[_poolId].checkPrice(_size > 0, tradePrice);

        // Calculate pool's new liquidityAmount
        int128 poolPofit = calculatePoolProfit(_poolId, _size, deltaM, tradePrice, hedgePositionValue);

        // Updates locked liquidity amount
        if (deltaM > 0) {
            require(liquidityAmount - pools[_poolId].lockedLiquidityAmount >= uint128(deltaM / 1e2), "PMC1");
            pools[_poolId].lockedLiquidityAmount += uint128(deltaM / 1e2);
        } else if (deltaM < 0) {
            pools[_poolId].lockedLiquidityAmount =
                (pools[_poolId].lockedLiquidityAmount * uint128(hedgePositionValue + deltaM)) /
                uint128(hedgePositionValue);
        }

        liquidityAmount = Math.addDelta(liquidityAmount, poolPofit);

        // Update trade time
        pools[_poolId].lastTradeTime = uint128(block.timestamp);

        if ((_size < 0 && pools[_poolId].size - _size > 0) || (_size > 0 && pools[_poolId].size - _size < 0)) {
            pools[_poolId].entryPrice += (pools[_poolId].entryPrice * _size) / (pools[_poolId].size - _size);
        } else {
            pools[_poolId].entryPrice += tradePrice * _size;
        }

        return (tradePrice * _size, pools[_poolId].cumulativeFundingFeePerSizeGlobal);
    }

    /**
     * @notice Calculates USDC amount and underlying amount for delta neutral
     * and store entryPrice price in netting info
     */
    function calculateEntryPriceForHedging()
        external
        onlyPerpetualMarket
        returns (
            bool isLong,
            uint128 underlyingAmount,
            uint128 usdcAmount
        )
    {
        (uint128 spot, ) = getUnderlyingPrice();

        (int128 sqeethPoolDelta, int128 futurePoolDelta) = getDeltas(int128(spot), pools[0].size, pools[1].size);

        {
            // 1. Calculate net delta
            int128 netDelta = (sqeethPoolDelta + futurePoolDelta) + nettingInfo.underlyingPosition;

            isLong = netDelta < 0;

            // 2. Calculate USDC and ETH amounts.
            underlyingAmount = Math.abs(netDelta) * 1e10;
            usdcAmount = (Math.abs(netDelta) * spot) / 1e10;
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
            int128[2] memory deltas;
            deltas[0] = sqeethPoolDelta;
            deltas[1] = futurePoolDelta;
            nettingInfo.complete(NettingLib.CompleteParams(int128(usdcAmount), int128(underlyingAmount), deltas, spot));
        }
    }

    /**
     * @notice Calculates ETH variance under the Exponentially Weighted Moving Average Model.
     */
    function updateVariance() external onlyPerpetualMarket {
        if (uint128(block.timestamp) < poolSnapshot.lastTimestamp + 12 hours) {
            return;
        }
        (uint128 spot, ) = getUnderlyingPrice();

        int128 u = ((int128(spot) - poolSnapshot.ethPrice) * 1e8) / poolSnapshot.ethPrice;

        u = (u * FUNDING_PERIOD) / int128(uint128(block.timestamp) - poolSnapshot.lastTimestamp);

        // Updates snapshot
        poolSnapshot.variance = (LAMBDA * poolSnapshot.variance + (1e8 - LAMBDA) * int128(Math.abs(u))) / 1e8;
        poolSnapshot.ethPrice = int128(spot);
        poolSnapshot.lastTimestamp = uint128(block.timestamp);
    }

    /////////////////////////
    //  Getter Functions   //
    /////////////////////////

    /**
     * @notice get trade price
     * @param _poolId pool id
     * @param _size size to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _poolId, int128 _size) external view returns (uint128) {
        (uint128 spot, ) = getUnderlyingPrice();

        int128 deltaM = getReqiredCollateral(_poolId, spot, _size);

        return calculateTradePrice(_poolId, spot, deltaM);
    }

    function getPoolState() external view returns (PoolState memory) {
        (uint128 spot, ) = getUnderlyingPrice();

        int128[2] memory markPrices;
        int128[2] memory cumFundingFeePerSizeGlobals;

        for (uint256 i = 0; i < MAX_POOL_ID; i++) {
            markPrices[i] = int128(getMarkPrice(i, spot));
            cumFundingFeePerSizeGlobals[i] = pools[i].cumulativeFundingFeePerSizeGlobal;
        }

        return PoolState(spot, markPrices, cumFundingFeePerSizeGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     * FundingPerSize = Price * FundingRate * (T-t) / 1 days
     */
    function executeFundingPayment(uint256 _poolId, uint128 _spot) internal {
        if (pools[_poolId].lastTradeTime == 0) {
            return;
        }

        uint128 price = Pricer.calculatePrice(_poolId, _spot);

        int128 currentFundingRate = getFundingRate(_poolId);

        int128 fundingFeePerSize = (int128(price) * currentFundingRate) / 1e8;

        fundingFeePerSize =
            (fundingFeePerSize * int128(uint128(block.timestamp) - pools[_poolId].lastTradeTime)) /
            FUNDING_PERIOD;

        pools[_poolId].cumulativeFundingFeePerSizeGlobal += fundingFeePerSize;

        liquidityAmount = Math.addDelta(liquidityAmount, (fundingFeePerSize * pools[_poolId].size) / 1e10);
    }

    /**
     * @notice Adds collateral to Netting contract
     */
    function addCollateral(uint256 _poolId, uint128 _spot) internal returns (int128, int128) {
        (int128 delta0, int128 delta1) = getDeltas(int128(_spot), pools[0].size, pools[1].size);
        int128 gamma = (Pricer.calculateGamma(0) * pools[0].size) / 1e8;

        return nettingInfo.addCollateral(_poolId, NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot));
    }

    /**
     * @notice Gets Δm
     */
    function getReqiredCollateral(
        uint256 _poolId,
        uint128 _spot,
        int128 _size
    ) internal view returns (int128) {
        int128 delta0;
        int128 delta1;
        int128 gamma;
        {
            int128 size0;
            int128 size1;

            if (_poolId == 0) {
                size0 += _size;
            }

            if (_poolId == 1) {
                size1 += _size;
            }

            (delta0, delta1) = getDeltas(int128(_spot), size0, size1);
            gamma = (Pricer.calculateGamma(0) * size0) / 1e8;
        }

        NettingLib.AddCollateralParams memory params = NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot);

        int128 totalRequiredCollateral = NettingLib.getRequiredCollateral(_poolId, params);

        int128 hedgePositionValue = nettingInfo.pools[_poolId].getHedgePositionValue(params.spot);

        return totalRequiredCollateral - hedgePositionValue;
    }

    /**
     * @notice Calculates pool's profit
     * @return poolProfit scaled by 1e6
     */
    function calculatePoolProfit(
        uint256 _poolId,
        int128 _size,
        int128 _deltaM,
        int128 _tradePrice,
        int128 _hedgePositionValue
    ) internal view returns (int128 poolProfit) {
        if ((_size < 0 && pools[_poolId].size - _size > 0) || (_size > 0 && pools[_poolId].size - _size < 0)) {
            // Δsize * (Price - entryPrice / size)
            poolProfit = (_size * (_tradePrice - pools[_poolId].entryPrice / (pools[_poolId].size - _size))) / 1e10;
        }

        if (_deltaM < 0) {
            // |Δm| * (1 - lockedLiquidityAmount / HedgePositionValue)
            poolProfit +=
                (-_deltaM * (1e6 - (int128(pools[_poolId].lockedLiquidityAmount) * 1e8) / _hedgePositionValue)) /
                1e8;
        }
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate + 0.5 * ΔFundingRate)
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePrice(
        uint256 _poolId,
        uint128 _spot,
        int128 _deltaM
    ) internal view returns (uint128) {
        uint128 price = Pricer.calculatePrice(_poolId, _spot);

        int128 currentFundingRate = getFundingRate(_poolId);

        int128 deltaFundingRate = getDeltaFundingRate(_poolId, _deltaM);

        return (price * uint128(1e8 + currentFundingRate + deltaFundingRate / 2)) / 1e8;
    }

    function getDeltas(
        int128 _spot,
        int128 _size0,
        int128 _size1
    ) internal pure returns (int128, int128) {
        int128 sqeethPoolDelta = -(Pricer.calculateDelta(0, _spot) * _size0) / 1e8;
        int128 futurePoolDelta = -(Pricer.calculateDelta(1, _spot) * _size1) / 1e8;
        return (sqeethPoolDelta, futurePoolDelta);
    }

    /**
     * @notice Gets LP token price
     * LPTokenPrice = (UnrealizedPnL_sqeeth + UnrealizedPnL_future + L - lockedLiquidity_sqeeth - lockedLiquidity_future) / Supply
     * @return LPTokenPrice scaled by 1e6
     */
    function getLPTokenPrice() public view returns (uint128) {
        (uint128 spot, ) = getUnderlyingPrice();

        return
            ((uint128(int128(liquidityAmount) + (getUnrealizedPnL(0, spot) + getUnrealizedPnL(1, spot)) / 1e2) -
                pools[0].lockedLiquidityAmount -
                pools[1].lockedLiquidityAmount) * 1e6) / supply;
    }

    /**
     * @notice Calculates Unrealized PnL
     * UnrealizedPnL = MarkPrice * size - entryPrice + HedgePositionValue
     * @return UnrealizedPnL scaled by 1e8
     */
    function getUnrealizedPnL(uint256 _poolId, uint128 _spot) internal view returns (int128) {
        uint128 markPrice = getMarkPrice(_poolId, _spot);
        return
            pools[_poolId].entryPrice /
            1e8 -
            (int128(markPrice) * pools[_poolId].size) /
            1e8 +
            nettingInfo.pools[_poolId].getHedgePositionValue(_spot);
    }

    /**
     * @notice Calculates perpetual's mark price
     * MarkPrice = IndexPrice * (1 + FundingRate)
     * @return mark price scaled by 1e8
     */
    function getMarkPrice(uint256 _poolId, uint128 _spot) internal view returns (uint128) {
        uint128 price = Pricer.calculatePrice(_poolId, _spot);

        int128 currentFundingRate = getFundingRate(_poolId);

        return (price * uint128(1e8 + currentFundingRate)) / 1e8;
    }

    /**
     * @notice Calculates perpetual's funding rate
     * Sqeeth: FundingRate = variance * (1 + m / L)
     * Future: FundingRate = (m / L)
     * @return FundingRate scaled by 1e8 (1e8 = 100%)
     */
    function getFundingRate(uint256 _poolId) internal view returns (int128) {
        int128 m = int128(pools[_poolId].lockedLiquidityAmount);
        // int128 m = NettingLib.getRequiredCollateral(_poolId, NettingLib.AddCollateralParams()) / 1e2;

        if (_poolId == 0) {
            if (liquidityAmount == 0) {
                return poolSnapshot.variance;
            } else {
                return (poolSnapshot.variance * (1e8 + (BETA_UR * m) / int128(liquidityAmount))) / 1e8;
            }
        } else if (_poolId == 1) {
            if (pools[_poolId].size > 0) {
                return (MAX_FUNDING_RATE * m) / int128(liquidityAmount);
            } else {
                return -(MAX_FUNDING_RATE * m) / int128(liquidityAmount);
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
    function getDeltaFundingRate(uint256 _poolId, int128 _deltaM) internal view returns (int128) {
        if (_poolId == 0) {
            return (poolSnapshot.variance * BETA_UR * _deltaM) / int128(liquidityAmount * 1e8);
        } else if (_poolId == 1) {
            return (MAX_FUNDING_RATE * _deltaM) / int128(liquidityAmount);
        }
        return 0;
    }

    /**
     * @notice get underlying price scaled by 1e8
     */
    function getUnderlyingPrice() internal view returns (uint128, uint256) {
        (, int256 answer, , uint256 roundTimestamp, ) = priceFeed.latestRoundData();

        require(answer > 0, "AN0");

        return (uint128(int128(answer)), roundTimestamp);
    }
}
