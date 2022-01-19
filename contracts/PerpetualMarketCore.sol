//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./lib/NettingLib.sol";
import "./lib/Pricer.sol";
import "./lib/SpreadLib.sol";
import "./lib/TraderVaultLib.sol";
import "hardhat/console.sol";

/**
 * @title PerpetualMarketCore
 * @notice Perpetual Market Core Contract
 * Error Code
 * PMC0: No available liquidity
 * PMC1: No available liquidity
 */
contract PerpetualMarketCore {
    using NettingLib for NettingLib.Info;
    using NettingLib for NettingLib.PoolInfo;

    // risk parameter for sqeeth pool is 20 %
    int128 constant BETA_UR = 2 * 1e7;

    // max funding rate of future pool is 0.02 %
    int128 constant MAX_FUNDING_RATE = 2 * 1e4;

    // funding period is 1 days
    int128 constant FUNDING_PERIOD = 1 days;

    struct Pool {
        uint128 lockedLiquidity;
        int128 size;
        int128 entry;
        int128 cumulativeFundingFeePerSizeGlobal;
        uint128 lastTradeTime;
    }

    struct PoolSnapshot {
        int128 deltaImpact;
        int128 variance;
        uint128 price;
        uint128 rateOfReturn;
    }

    struct PoolState {
        uint128 spot;
        int128 markPrice0;
        int128 markPrice1;
        int128 cumFundingFeePerSizeGlobal0;
        int128 cumFundingFeePerSizeGlobal1;
    }

    uint128 public supply;

    uint128 public liquidity;

    mapping(uint256 => Pool) public pools;

    PoolSnapshot private poolSnapshot;

    NettingLib.Info private nettingInfo;

    AggregatorV3Interface private priceFeed;

    constructor(address _priceFeedAddress) {
        priceFeed = AggregatorV3Interface(_priceFeedAddress);
    }

    /**
     * @notice initialize pool with initial liquidity and funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external returns (uint128 mintAmount) {
        require(supply == 0);
        mintAmount = _depositAmount;

        poolSnapshot.variance = _initialFundingRate;

        liquidity += _depositAmount;
        supply += mintAmount;
    }

    /**
     * @notice provide liquidity
     */
    function deposit(uint128 _depositAmount) external returns (uint128 mintAmount) {
        require(supply > 0);

        console.log(1, liquidity, pools[0].lockedLiquidity, pools[1].lockedLiquidity);

        mintAmount = (1e6 * _depositAmount) / getLPTokenPrice();

        liquidity += _depositAmount;
        supply += mintAmount;
    }

    /**
     * @notice withdraw liquidity
     */
    function withdraw(uint128 _withdrawnAmount) external returns (uint128 burnAmount) {
        burnAmount = (1e6 * _withdrawnAmount) / getLPTokenPrice();

        console.log(2, liquidity, pools[0].lockedLiquidity, pools[1].lockedLiquidity);

        require(liquidity - pools[0].lockedLiquidity - pools[1].lockedLiquidity >= _withdrawnAmount, "PMC0");

        liquidity -= _withdrawnAmount;
        supply -= burnAmount;
    }

    /**
     * @notice add or remove positions
     * @param _poolId pool id
     * @param _size size to trade. positive for pool short and negative for pool long.
     */
    function updatePoolPosition(uint256 _poolId, int128 _size) external returns (int128, int128) {
        (uint128 spot, ) = getUnderlyingPrice();

        // Funding payment
        executeFundingPayment(_poolId, spot);

        // Updates position size
        pools[_poolId].size += _size;

        // Add collateral to Netting contract
        (int128 deltaM, int128 hedgePositionValue) = addCollateral(_poolId, spot);

        // Calculate trade price
        int128 tradePrice = int128(calculateTradePrice(_poolId, spot, deltaM));

        // Calculate pool's new liquidity
        int128 poolPofit;

        if (_size < 0) {
            poolPofit = (_size * (tradePrice - pools[_poolId].entry / (pools[_poolId].size - _size))) / 1e10;
        }

        tradePrice = tradePrice * _size;

        pools[_poolId].entry += tradePrice;

        if (deltaM > 0) {
            require(liquidity - pools[_poolId].lockedLiquidity >= uint128(deltaM / 1e2), "PMC1");
            pools[_poolId].lockedLiquidity += uint128(deltaM / 1e2);
        } else if (deltaM < 0) {
            poolPofit += (-deltaM * (1e6 - (int128(pools[_poolId].lockedLiquidity) * 1e8) / hedgePositionValue)) / 1e8;

            pools[_poolId].lockedLiquidity =
                (pools[_poolId].lockedLiquidity * uint128(hedgePositionValue + deltaM)) /
                uint128(hedgePositionValue);
        }

        liquidity = Math.addDelta(liquidity, poolPofit);

        // Update trade time
        pools[_poolId].lastTradeTime = uint128(block.timestamp);

        return (tradePrice, pools[_poolId].cumulativeFundingFeePerSizeGlobal);
    }

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

        liquidity = Math.addDelta(liquidity, (fundingFeePerSize * pools[_poolId].size) / 1e10);
    }

    /**
     * @notice Adds collateral to Netting contract
     */
    function addCollateral(uint256 _poolId, uint128 _spot) internal returns (int128, int128) {
        int128 delta0 = (Pricer.calculateDelta(0, int128(_spot)) * pools[0].size) / 1e8;
        int128 delta1 = (Pricer.calculateDelta(1, int128(_spot)) * pools[1].size) / 1e8;
        int128 gamma = (Pricer.calculateGamma(0) * pools[0].size) / 1e8;

        return nettingInfo.addCollateral(_poolId, NettingLib.AddCollateralParams(delta0, delta1, gamma, _spot));
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

    function getPoolState() external view returns (PoolState memory) {
        (uint128 spot, ) = getUnderlyingPrice();

        return
            PoolState(
                spot,
                int128(getMarkPrice(0, spot)),
                int128(getMarkPrice(1, spot)),
                pools[0].cumulativeFundingFeePerSizeGlobal,
                pools[1].cumulativeFundingFeePerSizeGlobal
            );
    }

    /**
     * @notice Gets LP token price
     * LPTokenPrice = (UnrealizedPnL_sqeeth + UnrealizedPnL_future + L - lockedLiquidity_sqeeth - lockedLiquidity_future) / Supply
     * @return LPTokenPrice scaled by 1e6
     */
    function getLPTokenPrice() internal view returns (uint128) {
        (uint128 spot, ) = getUnderlyingPrice();

        return
            ((uint128(int128(liquidity) + (getUnrealizedPnL(0, spot) + getUnrealizedPnL(1, spot)) / 1e2) -
                pools[0].lockedLiquidity -
                pools[1].lockedLiquidity) * 1e6) / supply;
    }

    /**
     * @notice Calculates Unrealized PnL
     * UnrealizedPnL = MarkPrice * size - entry + HedgePositionValue
     * @return UnrealizedPnL scaled by 1e8
     */
    function getUnrealizedPnL(uint256 _poolId, uint128 _spot) internal view returns (int128) {
        uint128 markPrice = getMarkPrice(_poolId, _spot);
        return
            pools[_poolId].entry /
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
        int128 m = int128(pools[_poolId].lockedLiquidity);
        // int128 m = NettingLib.getRequiredCollateral(_poolId, NettingLib.AddCollateralParams()) / 1e2;

        if (_poolId == 0) {
            return (poolSnapshot.variance * (1e8 + (BETA_UR * m) / int128(liquidity))) / 1e8;
        } else if (_poolId == 1) {
            if (pools[_poolId].size > 0) {
                return (MAX_FUNDING_RATE * m) / int128(liquidity);
            } else {
                return -(MAX_FUNDING_RATE * m) / int128(liquidity);
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
            return (poolSnapshot.variance * BETA_UR * _deltaM) / int128(liquidity * 1e8);
        } else if (_poolId == 1) {
            return (MAX_FUNDING_RATE * _deltaM) / int128(liquidity);
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
