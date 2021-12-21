//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./interfaces/ILiquidityPool.sol";
import "./lib/LpPosition.sol";
import "./lib/FeeLevel.sol";
import "./lib/Hedging.sol";
import "./lib/Pricer.sol";
import "./lib/TradeStateLib.sol";
import "hardhat/console.sol";

/**
 * @title PerpetualMarket
 * @notice Perpetual Market Contract
 */
contract PerpetualMarket {
    using Hedging for Hedging.Info;
    using LpPosition for mapping(bytes32 => LpPosition.Info);
    using LpPosition for LpPosition.Info;
    using FeeLevel for mapping(int24 => IFeeLevel.Info);
    using FeeLevel for IFeeLevel.Info;
    using TradeStateLib for TradeStateLib.TradeState;

    // Cache data for TradeState
    struct TradeStateCache {
        uint128 liquidityDelta;
        uint128 liquidityBefore;
        uint128 lockedInLevel;
        int128 currentFeeLevel;
        int24 currentFeeLevelIndex;
        // Global feeLevel multiplied by liquidity
        uint128 feeLevelMultipliedLiquidityGlobal;
    }

    ILiquidityPool private immutable liquidityPool;

    struct Pool {
        uint256 id;
        // The normalization factor of the derivative price, which is reduced by the funding payment
        uint128 nfactor;
        // The last snapshot of required margin
        uint128 lastI;
        // Cumulative entry price of long side
        int128 entry;
        // The timestamp of last trade
        uint256 lastTradeTime;
        mapping(bytes32 => LpPosition.Info) lpPositions;
        mapping(int24 => IFeeLevel.Info) feeLevels;
        // Global realized profit and loss
        int128 realizedPnLGlobal;
        TradeStateLib.TradeState tradeState;
    }

    struct TraderPosition {
        int128[2] size;
        int128[2] entry;
        int128 usdcPosition;
    }

    mapping(uint256 => Pool) public pools;

    mapping(uint256 => int128) public positions;

    mapping(address => mapping(uint256 => TraderPosition)) private traders;

    AggregatorV3Interface private priceFeed;

    Hedging.Info private hedging;

    /**
     * @notice initialize perpetual pool
     */
    constructor(ILiquidityPool _liquidityPool, address _aggregator) {
        liquidityPool = _liquidityPool;
        priceFeed = AggregatorV3Interface(_aggregator);

        pools[0].id = 0;
        pools[1].id = 1;

        pools[0].nfactor = 1e8;
        pools[1].nfactor = 1e8;

        pools[0].lastTradeTime = block.timestamp;
        pools[1].lastTradeTime = block.timestamp;
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) external returns (uint128 depositAmount) {
        int24 currentFeeLevelIndex = getFeeLevelIndex(
            pools[_poolId].tradeState.currentFeeLevel
        );

        {
            (
                uint128 lockedLiquidity,
                uint128 unlockedLiquidity,
                uint128 liqDelta
            ) = pools[_poolId]
                    .tradeState
                    .calculateNotionalLockedAndUnlockedLiquidity(
                        currentFeeLevelIndex,
                        _feeLevelLower,
                        _feeLevelUpper,
                        _amount
                    );

            depositAmount = unlockedLiquidity;

            if (lockedLiquidity > 0) {
                depositAmount += calDepositAmount(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    currentFeeLevelIndex,
                    lockedLiquidity
                );
            }

            // console.log(5, uint24(currentFeeLevelIndex));

            pools[_poolId].tradeState.update(
                int128(lockedLiquidity),
                int128(liqDelta)
            );
        }

        _updatePosition(
            pools[_poolId],
            msg.sender,
            int128(_amount),
            _feeLevelLower,
            _feeLevelUpper
        );

        return depositAmount;
    }

    function calDepositAmount(
        Pool storage _pool,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        int24 _currentFeeLevelIndex,
        uint128 _lockedLiquidity
    ) internal view returns (uint128) {
        (uint128 spot, ) = getUnderlyingPrice();

        (uint128 liquidity, uint128 feeLevelMultipliedByLiquidity) = FeeLevel
            .getFeeLevelMultipliedByLiquidity(
                _pool.feeLevels,
                _feeLevelLower,
                _feeLevelUpper,
                _currentFeeLevelIndex,
                _pool.tradeState.liquidityBefore,
                _pool.tradeState.feeLevelMultipliedLiquidityGlobal
            );

        return
            (_lockedLiquidity *
                getUPnL(
                    _pool,
                    spot,
                    feeLevelMultipliedByLiquidity,
                    liquidity
                )) / 1e6;
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) external returns (uint128 withdrawableAmount) {
        TradeStateLib.TradeState storage tradeState = pools[_poolId].tradeState;

        uint128 collateralValue;
        uint128 size;

        {
            (
                uint128 lockedLiquidity,
                uint128 unlockedLiquidity,
                uint128 liqDelta
            ) = tradeState.calculateNotionalLockedAndUnlockedLiquidity(
                    getFeeLevelIndex(tradeState.currentFeeLevel),
                    _feeLevelLower,
                    _feeLevelUpper,
                    _amount
                );

            if (lockedLiquidity > 0) {
                collateralValue = calDepositAmount(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    getFeeLevelIndex(tradeState.currentFeeLevel),
                    lockedLiquidity
                );
                size = (lockedLiquidity * uint128(getSRate(_poolId))) / 1e6;
            }

            withdrawableAmount = unlockedLiquidity;

            pools[_poolId].tradeState.update(
                -int128(lockedLiquidity),
                -int128(liqDelta)
            );
        }

        if (size > 0) {
            (uint128 spot, ) = getUnderlyingPrice();
            makePositions(
                msg.sender,
                0,
                _poolId,
                -int128(size),
                calPrice(_poolId, spot)
            );
            checkIM(msg.sender, 0, int128(collateralValue));
        } else {
            withdrawableAmount += collateralValue;
        }

        LpPosition.Info storage position = _updatePosition(
            pools[_poolId],
            msg.sender,
            -int128(_amount),
            _feeLevelLower,
            _feeLevelUpper
        );

        withdrawableAmount += uint128(position.realizedPnL);
    }

    /**
     * @notice add or remove positions
     * @param _poolId The id of perpetual pool
     * @param _size The size to add or remove.
     * The size is positive for long positions and negative for short positions.
     */
    function addOrRemovePositions(uint256 _poolId, int128 _size)
        external
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        (uint128 spot, ) = getUnderlyingPrice();
        uint128 price = calPrice(_poolId, spot);

        // Calculate margin and price
        uint128 startI = calculateMargin(_poolId, spot);

        positions[_poolId] += _size;

        uint128 totalMargin = calculateMargin(_poolId, spot);

        uint128 deltaI;

        if (pool.lastI > startI) {
            trade(pool, spot, price, pool.lastI - startI, true);
        } else if (pool.lastI < startI) {
            trade(pool, spot, price, startI - pool.lastI, false);
        }

        if (totalMargin > startI) {
            deltaI = totalMargin - startI;
        } else {
            deltaI = startI - totalMargin;
        }

        uint128 markPrice = trade(
            pool,
            spot,
            price,
            deltaI,
            _size < 0 // false if buying
        );

        // Update hedging
        int128 derivativeDelta = Pricer.calculateDelta(_poolId, int128(spot));

        hedging.addPosition(
            _poolId,
            -derivativeDelta,
            int128(totalMargin) - int128(pool.lastI),
            spot
        );

        // Update pool info
        int128 totalPrice = (_size * int128(markPrice)) / 1e6;

        pool.entry += totalPrice;
        pool.lastI = totalMargin;
        pool.nfactor = calculateNewNFactor(_poolId);
        pool.lastTradeTime = block.timestamp;

        return LiqMath.abs(totalPrice);
    }

    /**
     * @notice make long or short positions
     */
    function makePositions(
        address _trader,
        uint256 _vaultId,
        uint256 _poolId,
        int128 _size,
        uint128 _price
    ) public {
        TraderPosition storage traderPosition = traders[_trader][_vaultId];

        traderPosition.size[_poolId] += _size;
        traderPosition.entry[_poolId] += _size * int128(_price);
    }

    /**
     * checm Initial Margin
     * @param _depositOrWithdrawAmount deposit for positive and withdrawal for negative
     * Min Int128 represents for full withdrawal
     */
    function checkIM(
        address _trader,
        uint256 _vaultId,
        int128 _depositOrWithdrawAmount
    ) public returns (int128 finalDepositOrWithdrawAmount) {
        TraderPosition storage traderPosition = traders[_trader][_vaultId];

        (uint128 spot, ) = getUnderlyingPrice();

        int128 im = getInitialMargin(traderPosition, spot);
        int128 derivativePnL = getPnL(traderPosition, spot);
        int128 pnl = traderPosition.usdcPosition + derivativePnL;

        if (_depositOrWithdrawAmount <= -pnl && pnl > 0) {
            finalDepositOrWithdrawAmount = -int128(pnl);
            traderPosition.usdcPosition = -derivativePnL;
        } else {
            traderPosition.usdcPosition += _depositOrWithdrawAmount;

            finalDepositOrWithdrawAmount = _depositOrWithdrawAmount;
        }

        require(traderPosition.usdcPosition + derivativePnL >= im, "IM");
    }

    /**
     * @notice liquidate short positions in a vault.
     */
    function liquidate(
        address _trader,
        uint256 _vaultId,
        uint256 _poolId,
        int128 _size
    ) external returns (uint128) {
        TraderPosition storage traderPosition = traders[_trader][_vaultId];

        (uint128 spot, ) = getUnderlyingPrice();

        require(
            traderPosition.usdcPosition + getPnL(traderPosition, spot) <
                getMaintenanceMargin(traderPosition, spot),
            "LB"
        );

        require(
            LiqMath.abs(traderPosition.size[_poolId]) >= LiqMath.abs(_size),
            "LS"
        );

        traderPosition.size[_poolId] -= _size;

        require(
            traderPosition.usdcPosition + getPnL(traderPosition, spot) >=
                getMaintenanceMargin(traderPosition, spot),
            "LA"
        );

        uint128 reward = 100 * 1e6 + (LiqMath.abs(_size) * spot) / 1e10;

        require(
            int128(reward) >
                getPnL(traderPosition, spot) + traderPosition.usdcPosition,
            "LR"
        );

        return reward;
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        (uint128 spot, ) = getUnderlyingPrice();

        int128 poolDelta = calNetDelta(int128(spot));

        int128 netDelta = poolDelta + hedging.underlyingPosition;

        hedging.complete(-netDelta, spot);

        if (netDelta < 0) {
            hedging.underlyingPosition += -netDelta;
            uint256 uAmount = uint128(-netDelta * 1e10);

            ERC20(liquidityPool.underlying()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uAmount
            );
            liquidityPool.sendLiquidity(
                msg.sender,
                (uint128(-netDelta) * spot) / 1e10
            );
        } else {
            hedging.underlyingPosition -= netDelta;
            uint256 uAmount = uint128(netDelta * 1e10);

            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                (uint128(netDelta) * spot) / 1e10
            );
            liquidityPool.sendUndrlying(msg.sender, uAmount);
        }
    }

    ////////////////////////
    //  Getter Functions  //
    ////////////////////////

    function getVault(address _trader, uint256 _vaultId)
        external
        view
        returns (TraderPosition memory traderPosition)
    {
        traderPosition = traders[_trader][_vaultId];
    }

    function getFeeLevel(uint256 _poolId) external view returns (int128) {
        return pools[_poolId].tradeState.currentFeeLevel;
    }

    //////////////////////////////
    //     Private Functions    //
    //////////////////////////////

    function calculateNewNFactor(uint256 _poolId)
        internal
        view
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        uint128 fundingFee = (1e10 *
            (uint128(pool.tradeState.currentFeeLevel) *
                uint128(block.timestamp - pool.lastTradeTime))) /
            (1 days * (1e10 + uint128(pool.tradeState.currentFeeLevel)));

        return (pool.nfactor * (1e16 - fundingFee)) / 1e16;
    }

    /**
     * @return totalPrice total price scaled by 1e6
     */
    function trade(
        Pool storage _pool,
        uint128 _spot,
        uint128 _price,
        uint128 _margin,
        bool _direction
    ) internal returns (uint128 totalPrice) {
        require(_margin > 0, "TM");

        TradeStateCache memory tradeStateCache = TradeStateCache(
            _pool.tradeState.liquidityDelta,
            _pool.tradeState.liquidityBefore,
            _pool.tradeState.lockedInLevel,
            _pool.tradeState.currentFeeLevel,
            getFeeLevelIndex(_pool.tradeState.currentFeeLevel),
            _pool.tradeState.feeLevelMultipliedLiquidityGlobal
        );

        uint128 remain = _margin;

        while (remain > 0) {
            tradeStateCache.currentFeeLevelIndex = getFeeLevelIndex(
                tradeStateCache.currentFeeLevel
            );

            IFeeLevel.Info memory feeLevel = _pool.feeLevels[
                tradeStateCache.currentFeeLevelIndex
            ];

            tradeStateCache.liquidityDelta = LiqMath.addDelta(
                tradeStateCache.liquidityDelta,
                feeLevel.liquidityNet
            );

            if (tradeStateCache.currentFeeLevel >= 3 * 1e8) {
                revert("OFL");
            }

            if (tradeStateCache.currentFeeLevel <= -3 * 1e8) {
                revert("LFL");
            }

            uint128 notionalPerLiquidity = _direction
                ? getUPnL(
                    _pool,
                    _spot,
                    (tradeStateCache.liquidityDelta *
                        uint128(
                            1e10 +
                                int128(tradeStateCache.currentFeeLevelIndex) /
                                2
                        )) / 1e10,
                    tradeStateCache.liquidityDelta
                )
                : getRPnL(_pool, tradeStateCache.currentFeeLevelIndex);

            uint128 marginStep = remain;
            int128 deltaH;

            {
                uint128 targetLiquidity = tradeStateCache.lockedInLevel;

                if (!_direction) {
                    targetLiquidity =
                        tradeStateCache.liquidityDelta -
                        targetLiquidity;
                }

                // jump if there is no liquidity
                if (targetLiquidity == 0) {
                    _pool.feeLevels.cross(
                        tradeStateCache.currentFeeLevelIndex,
                        _pool.realizedPnLGlobal
                    );

                    _cross(tradeStateCache, _direction);

                    _pool.tradeState.lockedInLevel = 0;

                    continue;
                }

                // calculate m

                marginStep = (1e6 * marginStep) / notionalPerLiquidity;

                if (marginStep >= targetLiquidity) {
                    remain = marginStep - targetLiquidity;
                    marginStep = targetLiquidity;

                    // update realized PnL
                    if (_direction) {
                        _pool.realizedPnLGlobal +=
                            ((int128(notionalPerLiquidity) - 1e6) *
                                int128(marginStep)) /
                            int128(tradeStateCache.liquidityDelta);
                    }

                    _pool.feeLevels.cross(
                        tradeStateCache.currentFeeLevelIndex,
                        _pool.realizedPnLGlobal
                    );

                    //_cross(_pool, tradeStateCache, _direction);

                    _pool.tradeState.lockedInLevel = 0;
                } else {
                    tradeStateCache.lockedInLevel += marginStep;
                    remain = 0;

                    // update realized PnL
                    if (_direction) {
                        _pool.realizedPnLGlobal +=
                            ((int128(notionalPerLiquidity) - 1e6) *
                                int128(marginStep)) /
                            int128(tradeStateCache.liquidityDelta);
                    }
                }

                deltaH = int128((marginStep * 1e6) / targetLiquidity);
                if (_direction) {
                    deltaH = -deltaH;
                }
            }

            // calculate price
            uint128 priceInFeeLevel = (_price *
                (1e10 +
                    (
                        LiqMath.abs(
                            (2 * tradeStateCache.currentFeeLevel + deltaH) *
                                deltaH
                        )
                    ) /
                    (2 * 1e10))) / 1e12;
            totalPrice += (marginStep * priceInFeeLevel) / _margin;

            tradeStateCache.currentFeeLevel += deltaH;

            if (_direction) {
                tradeStateCache.liquidityBefore -= marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal -=
                    (marginStep *
                        uint128(
                            1e10 +
                                int128(tradeStateCache.currentFeeLevelIndex) /
                                2
                        )) /
                    1e10;
            } else {
                tradeStateCache.liquidityBefore += marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal +=
                    (marginStep *
                        uint128(
                            1e10 +
                                int128(tradeStateCache.currentFeeLevelIndex) /
                                2
                        )) /
                    1e10;
            }
        }

        // Update tradeState
        _pool.tradeState.liquidityDelta = tradeStateCache.liquidityDelta;
        _pool.tradeState.liquidityBefore = tradeStateCache.liquidityBefore;
        _pool.tradeState.lockedInLevel = tradeStateCache.lockedInLevel;
        _pool.tradeState.currentFeeLevel = tradeStateCache.currentFeeLevel;

        _pool.tradeState.feeLevelMultipliedLiquidityGlobal = tradeStateCache
            .feeLevelMultipliedLiquidityGlobal;
    }

    function _cross(TradeStateCache memory _cache, bool _direction)
        internal
        pure
    {
        if (_direction) {
            _cache.currentFeeLevel =
                int128(_cache.currentFeeLevelIndex) *
                1e6 -
                1e6;
        } else {
            _cache.currentFeeLevel =
                int128(_cache.currentFeeLevelIndex) *
                1e6 +
                1e6;
        }
    }

    function _updatePosition(
        Pool storage _pool,
        address _provider,
        int128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) internal returns (LpPosition.Info storage) {
        LpPosition.Info storage position = _pool.lpPositions.get(
            _provider,
            _feeLevelLower,
            _feeLevelUpper
        );

        int128 feeGrowthInside = _pool.feeLevels.getFeeGrowthInside(
            _feeLevelLower,
            _feeLevelUpper,
            getFeeLevelIndex(_pool.tradeState.currentFeeLevel),
            _pool.realizedPnLGlobal
        );

        int128 amountPerFeeLevel = _amount / (_feeLevelUpper - _feeLevelLower);
        _pool.feeLevels.update(_feeLevelLower, amountPerFeeLevel);
        _pool.feeLevels.update(_feeLevelUpper, -amountPerFeeLevel);

        position.update(_amount, feeGrowthInside);

        return position;
    }

    function getFeeLevelIndex(int128 _feeLevel) internal pure returns (int24) {
        return int24(_feeLevel / 1e6);
    }

    function getUnrealizedPnLPerLiquidity(uint256 _poolId)
        public
        view
        returns (uint128)
    {
        (uint128 spot, ) = getUnderlyingPrice();

        return
            getUPnL(
                pools[_poolId],
                spot,
                pools[_poolId].tradeState.feeLevelMultipliedLiquidityGlobal,
                1e6
            );
    }

    /**
     * @notice Calculates collateral's notional value per liquidity
     * @return Notional value per liquidity scaled by 1e6
     */
    function getUPnL(
        Pool storage _pool,
        uint128 _spot,
        uint128 _feeLevelMultipliedByLiquidity,
        uint128 _liquidity
    ) internal view returns (uint128) {
        uint128 weight = (_feeLevelMultipliedByLiquidity * 1e12) /
            (_pool.tradeState.feeLevelMultipliedLiquidityGlobal * _liquidity);

        int128 totalNotional = int128(_pool.tradeState.liquidityBefore) +
            calculateUnrealizedPnL(_pool.id, _spot, weight);

        require(totalNotional > 0, "Insolvency");

        return
            (1e6 * uint128(totalNotional)) / _pool.tradeState.liquidityBefore;
    }

    function getRPnL(Pool storage _pool, int24 _feeLevel)
        internal
        view
        returns (uint128)
    {
        int128 realizedPnLInside = _pool.feeLevels.getFeeGrowthInside(
            _feeLevel,
            _feeLevel + 1,
            _feeLevel,
            _pool.realizedPnLGlobal
        );

        return uint128(int128(1e6) + realizedPnLInside);
    }

    /**
     * @notice Calculates position size per liquidity
     * @return Position size per liquidity scaled by 1e8
     */
    function getSRate(uint256 _poolId) internal view returns (int128) {
        return
            (1e6 * positions[_poolId]) /
            int128(pools[_poolId].tradeState.liquidityBefore);
    }

    /**
     * @return calculate notional unrealized PnL scaled by 1e6;
     */
    function calculateUnrealizedPnL(
        uint256 _poolId,
        uint128 _spot,
        uint128 _weight
    ) internal view returns (int128) {
        uint128 price = calPrice(_poolId, _spot);

        int128 hedgeNotional = (-int128(_spot) * hedging.pools[_poolId].delta) /
            1e8 -
            Hedging.getEntry(hedging.pools[_poolId], _spot);

        int128 positionNotional = ((int128(_weight) *
            pools[_poolId].entry *
            int128(pools[_poolId].tradeState.liquidityBefore)) /
            1e12 -
            (int128(price) * positions[_poolId]) /
            1e8);

        return (hedgeNotional + positionNotional) / 1e2;
    }

    /**
     * @notice Calculates perpetual's price multiplied by normalization factor
     */
    function calPrice(uint256 _poolId, uint128 _spot)
        internal
        view
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        uint128 price = (pool.nfactor * Pricer.calculatePrice(_poolId, _spot)) /
            1e8;

        return (price * uint128(1e10 + pool.tradeState.currentFeeLevel)) / 1e10;
    }

    /**
     * @notice Calculate required margin for delta hedging
     * @return required margin scaled by 1e6
     */
    function calculateMargin(uint256 _poolId, uint128 _spot)
        internal
        view
        returns (uint128)
    {
        return
            (120 *
                _spot *
                LiqMath.abs(calculateWeightedDelta(_poolId, int128(_spot)))) /
            (100 * 1e10);
    }

    function calNetDelta(int128 _spot) internal view returns (int128) {
        int128 delta1 = Pricer.calculateDelta(0, _spot);
        int128 delta2 = Pricer.calculateDelta(1, _spot);

        return positions[0] * delta1 + positions[1] * delta2;
    }

    function calculateWeightedDelta(uint256 _poolId, int128 _spot)
        internal
        view
        returns (int128)
    {
        int128 delta1 = Pricer.calculateDelta(0, _spot);
        int128 delta2 = Pricer.calculateDelta(1, _spot);

        int128 netDelta = positions[0] * delta1 + positions[1] * delta2;
        int128 totalDelta = int128(
            LiqMath.abs(positions[0] * delta1) +
                LiqMath.abs(positions[1] * delta2)
        );

        require(totalDelta >= 0, "WD");

        if (totalDelta == 0) {
            return 0;
        }

        if (_poolId == 0) {
            return (positions[0] * delta1 * netDelta) / (1e8 * totalDelta);
        } else if (_poolId == 1) {
            return (positions[1] * delta2 * netDelta) / (1e8 * totalDelta);
        } else {
            revert("NP");
        }
    }

    function getInitialMargin(
        TraderPosition memory _traderPosition,
        uint128 _spot
    ) internal pure returns (int128) {
        uint128 im = ((LiqMath.abs(_traderPosition.size[0]) +
            LiqMath.abs(_traderPosition.size[1])) *
            _spot *
            20) / (100 * 1e10);

        return int128(im);
    }

    function getMaintenanceMargin(
        TraderPosition memory _traderPosition,
        uint128 _spot
    ) internal pure returns (int128) {
        uint128 im = ((LiqMath.abs(_traderPosition.size[0]) +
            LiqMath.abs(_traderPosition.size[1])) *
            _spot *
            8) / (100 * 1e10);

        return int128(im);
    }

    function getPnL(TraderPosition memory _traderPosition, uint128 _spot)
        internal
        view
        returns (int128)
    {
        int128 pnl = (int128(calPrice(0, _spot)) *
            _traderPosition.size[0] -
            _traderPosition.entry[0] +
            int128(calPrice(1, _spot)) *
            _traderPosition.size[1] -
            _traderPosition.entry[1]);

        return pnl / 1e10;
    }

    /**
     * @notice get underlying price scaled by 1e8
     */
    function getUnderlyingPrice() internal view returns (uint128, uint256) {
        (, int256 answer, , uint256 roundTimestamp, ) = priceFeed
            .latestRoundData();

        require(answer > 0, "AN0");

        return (uint128(int128(answer)), roundTimestamp);
    }
}
