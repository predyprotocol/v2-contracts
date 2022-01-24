//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "@chainlink/contracts/src/v0.7/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
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
    using SafeCast for int128;
    using SafeMath for uint256;
    using SafeMath for uint128;
    using SafeMath for int128;

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

        (int128 spotPrice, ) = getUnderlyingPrice();

        poolSnapshot.ethVariance = _initialFundingRate;
        poolSnapshot.ethPrice = spotPrice;
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
            amountLiquidity - pools[0].amountLockedLiquidity - pools[1].amountLockedLiquidity >= _withdrawnAmount,
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
        returns (int128, int128)
    {
        require(amountLiquidity > 0, "PMC1");

        (int128 spotPrice, ) = getUnderlyingPrice();

        // Funding payment
        executeFundingPayment(_productId, spotPrice);

        // Updates position size
        pools[_productId].amountAsset += _tradeAmount;

        // Add collateral to Netting contract
        (int128 deltaM, int128 hedgePositionValue) = addCollateral(_productId, spotPrice);

        // Calculate trade price
        int128 tradePrice = calculateTradePrice(_productId, spotPrice, deltaM);

        // Manages spread
        tradePrice = spreadInfos[_productId].checkPrice(_tradeAmount > 0, tradePrice);

        // Calculate pool's new amountLiquidity
        int128 poolPofit = calculatePoolProfit(_productId, _tradeAmount, deltaM, tradePrice, hedgePositionValue);

        // Updates locked liquidity amount
        if (deltaM > 0) {
            require(amountLiquidity - pools[_productId].amountLockedLiquidity >= uint128(deltaM / 1e2), "PMC1");
            pools[_productId].amountLockedLiquidity += uint128(deltaM / 1e2);
        } else if (deltaM < 0) {
            pools[_productId].amountLockedLiquidity =
                (pools[_productId].amountLockedLiquidity * uint128(hedgePositionValue + deltaM)) /
                uint128(hedgePositionValue);
        }

        amountLiquidity = Math.addDelta(amountLiquidity, poolPofit);

        // Update trade time
        pools[_productId].lastTradeTime = uint128(block.timestamp);

        if (
            (_tradeAmount < 0 && pools[_productId].amountAsset - _tradeAmount > 0) ||
            (_tradeAmount > 0 && pools[_productId].amountAsset - _tradeAmount < 0)
        ) {
            pools[_productId].valueEntry +=
                (pools[_productId].valueEntry * _tradeAmount) /
                (pools[_productId].amountAsset - _tradeAmount);
        } else {
            pools[_productId].valueEntry += tradePrice * _tradeAmount;
        }

        return (tradePrice * _tradeAmount, pools[_productId].amountFundingFeePerSize * _tradeAmount);
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
            uint128 underlyingAmount,
            uint128 usdcAmount
        )
    {
        (int128 spotPrice, ) = getUnderlyingPrice();

        (int128 sqeethPoolDelta, int128 futurePoolDelta) = getDeltas(
            spotPrice,
            pools[0].amountAsset,
            pools[1].amountAsset
        );

        {
            // 1. Calculate net delta
            int128 netDelta = (sqeethPoolDelta + futurePoolDelta) + nettingInfo.amountUnderlying;

            isLong = netDelta < 0;

            // 2. Calculate USDC and ETH amounts.
            underlyingAmount = Math.abs(netDelta) * 1e10;
            usdcAmount = (Math.abs(netDelta) * uint128(spotPrice)) / 1e10;
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
        (int128 spotPrice, ) = getUnderlyingPrice();

        // u_{t-1} = (S_t - S_{t-1}) / S_{t-1}
        int128 u = ((spotPrice - poolSnapshot.ethPrice) * 1e8) / poolSnapshot.ethPrice;

        u = (u * FUNDING_PERIOD) / (block.timestamp - poolSnapshot.lastSnapshotTime).toInt256().toInt128();

        // Updates snapshot
        // variance_{t} = λ * variance_{t-1} + (1 - λ) * u_{t-1}^2
        poolSnapshot.ethVariance = (LAMBDA * poolSnapshot.ethVariance + ((1e8 - LAMBDA) * (u * u)) / 1e8) / 1e8;
        poolSnapshot.ethPrice = spotPrice;
        poolSnapshot.lastSnapshotTime = block.timestamp.toUint128();
    }

    /////////////////////////
    //  Getter Functions   //
    /////////////////////////

    /**
     * @notice get trade price
     * @param _productId product id
     * @param _tradeAmount size to trade. positive for pool short and negative for pool long.
     */
    function getTradePrice(uint256 _productId, int128 _tradeAmount) external view returns (int128) {
        (int128 spotPrice, ) = getUnderlyingPrice();

        int128 deltaM = getReqiredCollateral(_productId, spotPrice, _tradeAmount);

        return calculateTradePrice(_productId, spotPrice, deltaM);
    }

    function getPoolState() external view override returns (PoolState memory) {
        (int128 spotPrice, ) = getUnderlyingPrice();

        int128[2] memory markPrices;
        int128[2] memory cumFundingFeePerSizeGlobals;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            markPrices[i] = getMarkPrice(i, spotPrice);
            cumFundingFeePerSizeGlobals[i] = pools[i].amountFundingFeePerSize;
        }

        return PoolState(uint128(spotPrice), markPrices, cumFundingFeePerSizeGlobals);
    }

    /////////////////////////
    //  Private Functions  //
    /////////////////////////

    /**
     * @notice Executes funding payment
     * FundingPerSize = Price * FundingRate * (T-t) / 1 days
     */
    function executeFundingPayment(uint256 _productId, int128 _spotPrice) internal {
        if (pools[_productId].lastTradeTime == 0) {
            return;
        }

        int128 indexPrice = Pricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = getFundingRate(_productId);

        int128 fundingFeePerSize = ((indexPrice * currentFundingRate) / 1e8).toInt128();

        fundingFeePerSize =
            (fundingFeePerSize * int128(uint128(block.timestamp) - pools[_productId].lastTradeTime)) /
            FUNDING_PERIOD;

        pools[_productId].amountFundingFeePerSize += fundingFeePerSize;

        amountLiquidity = Math.addDelta(amountLiquidity, (fundingFeePerSize * pools[_productId].amountAsset) / 1e10);
    }

    /**
     * @notice Adds collateral to Netting contract
     */
    function addCollateral(uint256 _productId, int128 _spot) internal returns (int128, int128) {
        (int128 delta0, int128 delta1) = getDeltas(_spot, pools[0].amountAsset, pools[1].amountAsset);
        int128 gamma = (Pricer.calculateGamma(0) * pools[0].amountAsset) / 1e8;

        return nettingInfo.addCollateral(_productId, NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot));
    }

    /**
     * @notice Gets Δm
     */
    function getReqiredCollateral(
        uint256 _productId,
        int128 _spot,
        int128 _tradeAmount
    ) internal view returns (int128) {
        int128 delta0;
        int128 delta1;
        int128 gamma;
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
            gamma = (Pricer.calculateGamma(0) * tradeAmount0) / 1e8;
        }

        NettingLib.AddCollateralParams memory params = NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot);

        int128 totalRequiredCollateral = NettingLib.getRequiredCollateral(_productId, params);

        int128 hedgePositionValue = nettingInfo.pools[_productId].getHedgePositionValue(params.spotPrice);

        return totalRequiredCollateral - hedgePositionValue;
    }

    /**
     * @notice Calculates pool's profit
     * @return poolProfit scaled by 1e6
     */
    function calculatePoolProfit(
        uint256 _productId,
        int128 _tradeAmount,
        int128 _deltaM,
        int128 _tradePrice,
        int128 _hedgePositionValue
    ) internal view returns (int128 poolProfit) {
        if (
            (_tradeAmount < 0 && pools[_productId].amountAsset - _tradeAmount > 0) ||
            (_tradeAmount > 0 && pools[_productId].amountAsset - _tradeAmount < 0)
        ) {
            // Δsize * (Price - valueEntry / tradeAmount)
            poolProfit =
                (_tradeAmount *
                    (_tradePrice - pools[_productId].valueEntry / (pools[_productId].amountAsset - _tradeAmount))) /
                1e10;
        }

        if (_deltaM < 0) {
            // |Δm| * (1 - amountLockedLiquidity / HedgePositionValue)
            poolProfit +=
                (-_deltaM * (1e6 - (int128(pools[_productId].amountLockedLiquidity) * 1e8) / _hedgePositionValue)) /
                1e8;
        }
    }

    /**
     * @notice Calculates perpetual's trade price
     * TradePrice = IndexPrice * (1 + FundingRate + 0.5 * ΔFundingRate)
     * @return TradePrice scaled by 1e8
     */
    function calculateTradePrice(
        uint256 _productId,
        int128 _spotPrice,
        int128 _deltaM
    ) internal view returns (int128) {
        int128 indexPrice = Pricer.calculateIndexPrice(_productId, _spotPrice);

        int256 currentFundingRate = getFundingRate(_productId);

        int256 deltaFundingRate = getDeltaFundingRate(_productId, _deltaM);

        return ((indexPrice * (1e8 + currentFundingRate + deltaFundingRate / 2)) / 1e8).toInt128();
    }

    function getDeltas(
        int128 _spotPrice,
        int128 _tradeAmount0,
        int128 _tradeAmount1
    ) internal pure returns (int128, int128) {
        int128 sqeethPoolDelta = -(Pricer.calculateDelta(0, _spotPrice) * _tradeAmount0) / 1e8;
        int128 futurePoolDelta = -(Pricer.calculateDelta(1, _spotPrice) * _tradeAmount1) / 1e8;
        return (sqeethPoolDelta, futurePoolDelta);
    }

    /**
     * @notice Gets LP token price
     * LPTokenPrice = (UnrealizedPnL_sqeeth + UnrealizedPnL_future + L - lockedLiquidity_sqeeth - lockedLiquidity_future) / Supply
     * @return LPTokenPrice scaled by 1e6
     */
    function getLPTokenPrice() public view returns (uint256) {
        (int128 spotPrice, ) = getUnderlyingPrice();

        return
            ((uint256(
                amountLiquidity.toInt256() + (getUnrealizedPnL(0, spotPrice) + getUnrealizedPnL(1, spotPrice)) / 1e2
            ) -
                pools[0].amountLockedLiquidity -
                pools[1].amountLockedLiquidity) * 1e6) / supply;
    }

    /**
     * @notice Calculates Unrealized PnL
     * UnrealizedPnL = MarkPrice * amountAsset - valueEntry + HedgePositionValue
     * @return UnrealizedPnL scaled by 1e8
     */
    function getUnrealizedPnL(uint256 _productId, int128 _spot) internal view returns (int128) {
        int128 markPrice = getMarkPrice(_productId, _spot);
        return
            pools[_productId].valueEntry /
            1e8 -
            (markPrice * pools[_productId].amountAsset) /
            1e8 +
            nettingInfo.pools[_productId].getHedgePositionValue(_spot);
    }

    /**
     * @notice Calculates perpetual's mark price
     * MarkPrice = IndexPrice * (1 + FundingRate)
     * @return mark price scaled by 1e8
     */
    function getMarkPrice(uint256 _productId, int128 _spot) internal view returns (int128) {
        int128 indexPrice = Pricer.calculateIndexPrice(_productId, _spot);

        int256 currentFundingRate = getFundingRate(_productId);

        return ((indexPrice * (1e8 + currentFundingRate)) / 1e8).toInt128();
    }

    /**
     * @notice Calculates perpetual's funding rate
     * Sqeeth: FundingRate = variance * (1 + m / L)
     * Future: FundingRate = (m / L)
     * @return FundingRate scaled by 1e8 (1e8 = 100%)
     */
    function getFundingRate(uint256 _productId) internal view returns (int256) {
        int128 m = pools[_productId].amountLockedLiquidity.toInt256().toInt128();
        // int128 m = NettingLib.getRequiredCollateral(_productId, NettingLib.AddCollateralParams()) / 1e2;

        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            if (liquidityAmountInt256 == 0) {
                return poolSnapshot.ethVariance;
            } else {
                return ((poolSnapshot.ethVariance * (1e8 + (BETA_UR * m) / liquidityAmountInt256)) / 1e8).toInt128();
            }
        } else if (_productId == 1) {
            if (pools[_productId].amountAsset > 0) {
                return ((MAX_FUNDING_RATE * m) / liquidityAmountInt256).toInt128();
            } else {
                return -((MAX_FUNDING_RATE * m) / liquidityAmountInt256).toInt128();
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
    function getDeltaFundingRate(uint256 _productId, int128 _deltaM) internal view returns (int256) {
        int256 liquidityAmountInt256 = amountLiquidity.toInt256();

        if (_productId == 0) {
            return ((poolSnapshot.ethVariance * BETA_UR * _deltaM) / (liquidityAmountInt256 * 1e8));
        } else if (_productId == 1) {
            return ((MAX_FUNDING_RATE * _deltaM) / liquidityAmountInt256);
        }
        return 0;
    }

    /**
     * @notice get underlying price scaled by 1e8
     */
    function getUnderlyingPrice() internal view returns (int128, uint256) {
        (, int256 answer, , uint256 roundTimestamp, ) = priceFeed.latestRoundData();

        require(answer > 0, "PMC3");

        return (answer.toInt128(), roundTimestamp);
    }
}
