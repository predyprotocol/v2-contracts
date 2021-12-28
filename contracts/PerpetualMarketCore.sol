//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
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
contract PerpetualMarketCore {
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
        uint128 lockedLiquidity;
        int128 currentFeeLevel;
        int24 currentFeeLevelIndex;
        int24 nextFeeLevelIndex;
        // Global feeLevel multiplied by liquidity
        uint128 feeLevelMultipliedLiquidityGlobal;
        int128 realizedPnLGlobal;
    }

    struct Pool {
        uint16 id;
        // The normalization factor of the derivative price, which is reduced by the funding payment
        uint128 nfactor;
        // The last snapshot of required margin
        int128 lastI;
        // Cumulative entry price of long side
        int128 entry;
        // The timestamp of last trade
        uint128 lastTradeTime;
        mapping(bytes32 => LpPosition.Info) lpPositions;
        mapping(int24 => IFeeLevel.Info) feeLevels;
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
    constructor(address _aggregator) {
        priceFeed = AggregatorV3Interface(_aggregator);

        pools[0].id = 0;
        pools[1].id = 1;

        pools[0].nfactor = 1e8;
        pools[1].nfactor = 1e8;

        pools[0].lastTradeTime = uint128(block.timestamp);
        pools[1].lastTradeTime = uint128(block.timestamp);
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    )
        external
        returns (
            uint128 depositAmount,
            uint128 size,
            int128 entryPrice
        )
    {
        TradeStateLib.TradeState storage tradeState = pools[_poolId].tradeState;

        {
            (
                uint128 lockedLiquidity,
                uint128 unlockedLiquidity,
                uint128 liqDelta,
                uint128 feeLevelMuptipliedLiquidity
            ) = tradeState.calculateLockedAndUnlockedLiquidity(
                    tradeState.currentFeeLevelIndex,
                    _feeLevelLower,
                    _feeLevelUpper,
                    _amount
                );

            if (lockedLiquidity > 0) {
                size = (lockedLiquidity * uint128(getSRate(_poolId))) / 1e6;
            }

            tradeState.update(
                int128(lockedLiquidity),
                int128(liqDelta),
                int128(feeLevelMuptipliedLiquidity)
            );

            _updatePosition(
                pools[_poolId],
                msg.sender,
                int128(_amount),
                _feeLevelLower,
                _feeLevelUpper
            );

            if (lockedLiquidity > 0) {
                uint128 lockedNotional;
                (lockedNotional, entryPrice) = calculateLockedNotional(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    lockedLiquidity
                );
                depositAmount += lockedNotional;

                entryPrice = (entryPrice * int128(size)) / 1e8;

                positions[_poolId] += int128(size);
                pools[_poolId].entry += entryPrice;
            }

            if (unlockedLiquidity > 0) {
                depositAmount += calculateUnlockedNotional(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    unlockedLiquidity
                );
            }
        }
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    )
        external
        returns (
            uint128 withdrawableAmount,
            uint128 size,
            int128 entryPrice
        )
    {
        TradeStateLib.TradeState storage tradeState = pools[_poolId].tradeState;

        {
            (
                uint128 lockedLiquidity,
                uint128 unlockedLiquidity,
                uint128 liqDelta,
                uint128 feeLevelMuptipliedLiquidity
            ) = tradeState.calculateLockedAndUnlockedLiquidity(
                    tradeState.currentFeeLevelIndex,
                    _feeLevelLower,
                    _feeLevelUpper,
                    _amount
                );

            if (lockedLiquidity > 0) {
                size = (lockedLiquidity * uint128(getSRate(_poolId))) / 1e6;
            }

            tradeState.update(
                -int128(lockedLiquidity),
                -int128(liqDelta),
                -int128(feeLevelMuptipliedLiquidity)
            );

            if (lockedLiquidity > 0) {
                uint128 lockedNotional;
                (lockedNotional, entryPrice) = calculateLockedNotional(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    lockedLiquidity
                );
                withdrawableAmount += lockedNotional;

                entryPrice = (entryPrice * int128(size)) / 1e8;

                positions[_poolId] -= int128(size);
                pools[_poolId].entry -= entryPrice;
            }

            if (unlockedLiquidity > 0) {
                withdrawableAmount = calculateUnlockedNotional(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    unlockedLiquidity
                );
            }
        }

        _updatePosition(
            pools[_poolId],
            msg.sender,
            -int128(_amount),
            _feeLevelLower,
            _feeLevelUpper
        );
    }

    function calculateLockedNotional(
        Pool storage _pool,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _lockedLiquidity
    ) internal view returns (uint128, int128) {
        (uint128 spot, ) = getUnderlyingPrice();

        (
            uint128 liquidity,
            uint128 feeLevelMultipliedByLiquidity
        ) = TradeStateLib.getFeeLevelMultipliedByLiquidity(
                _pool.tradeState,
                _pool.feeLevels,
                _feeLevelLower,
                _feeLevelUpper,
                _pool.tradeState.currentFeeLevelIndex
            );

        uint128 lockedNotional = (_lockedLiquidity *
            getUPnL(
                _pool,
                spot,
                getMarkPrice(_pool.id, spot),
                feeLevelMultipliedByLiquidity,
                liquidity
            )) / 1e6;

        uint128 weight = (feeLevelMultipliedByLiquidity *
            (_pool.tradeState.liquidityBefore) *
            1e6) /
            (_pool.tradeState.feeLevelMultipliedLiquidityGlobal * liquidity);

        int128 entryPrice = (1e2 * int128(weight) * _pool.entry) /
            positions[_pool.id];
        return (lockedNotional, entryPrice);
    }

    function calculateUnlockedNotional(
        Pool storage _pool,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _unlockedLiquidity
    ) internal view returns (uint128) {
        int128 realizedPnL = _pool.feeLevels.getFeeGrowthInside(
            _feeLevelLower,
            _feeLevelUpper,
            _pool.tradeState.currentFeeLevelIndex,
            _pool.tradeState.realizedPnLGlobal
        );

        return (_unlockedLiquidity * uint128(int128(1e6) + realizedPnL)) / 1e6;
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
        uint128 price = getDerivativeIndexPrice(_poolId, spot);

        // Calculate margin and price
        int128 startI = int128(calculateMargin(_poolId, spot));

        positions[_poolId] += _size;

        int128 totalMargin = int128(calculateMargin(_poolId, spot));

        uint128 markPrice;
        int128 feeLevel;
        int128 m = LiqMath.min(totalMargin - pool.lastI, totalMargin - startI);

        if (_size < 0) {
            (markPrice, feeLevel) = trade(pool, spot, price, m);
        } else if (_size > 0) {
            (markPrice, feeLevel) = trade(
                pool,
                spot,
                price,
                m > 0 ? m : int128(1)
            );
        }

        // Update hedging
        int128 derivativeDelta = Pricer.calculateDelta(_poolId, int128(spot));

        hedging.addPosition(_poolId, -derivativeDelta, m, spot);

        // Update pool info
        int128 totalPrice = (_size * int128(markPrice)) / 1e6;

        pool.entry += totalPrice;
        pool.lastI = totalMargin;
        pool.nfactor = calculateNewNFactor(_poolId, feeLevel);
        pool.lastTradeTime = uint128(block.timestamp);

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
    function execHedge()
        external
        returns (
            uint256,
            uint256,
            bool
        )
    {
        (uint128 spot, ) = getUnderlyingPrice();

        int128 poolDelta = calNetDelta(int128(spot));

        int128 netDelta = poolDelta + hedging.underlyingPosition;

        hedging.complete(-netDelta, spot);

        if (netDelta < 0) {
            hedging.underlyingPosition += -netDelta;
            uint256 uAmount = uint128(-netDelta * 1e10);

            return ((uint128(-netDelta) * spot) / 1e10, uAmount, true);
        } else {
            hedging.underlyingPosition -= netDelta;
            uint256 uAmount = uint128(netDelta * 1e10);

            return ((uint128(netDelta) * spot) / 1e10, uAmount, false);
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

    //////////////////////////////
    //     Private Functions    //
    //////////////////////////////

    function calculateNewNFactor(uint256 _poolId, int128 _feeLevel)
        internal
        view
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        int128 currentFeeLevel = _feeLevel;

        uint128 fundingFee = (1e10 *
            (uint128(currentFeeLevel) *
                uint128(block.timestamp - pool.lastTradeTime))) /
            (1 days * (1e10 + uint128(currentFeeLevel)));

        return (pool.nfactor * (1e16 - fundingFee)) / 1e16;
    }

    function getCurrentFeeLevel(Pool storage _pool)
        internal
        view
        returns (int128)
    {
        return
            _getCurrentFeeLevel(
                _pool.tradeState.currentFeeLevelIndex,
                _pool.tradeState.lockedLiquidity,
                _pool.tradeState.liquidityDelta
            );
    }

    function _getCurrentFeeLevel(
        int128 _currentFeeLevelIndex,
        uint128 _lockedLiquidity,
        uint128 _liquidityDelta
    ) internal pure returns (int128) {
        int128 baseFeeLevel = int128(1e6) * _currentFeeLevelIndex;

        if (_liquidityDelta == 0) {
            return 0;
        }

        if (baseFeeLevel >= 0) {
            return
                baseFeeLevel +
                int128((1e6 * _lockedLiquidity) / _liquidityDelta);
        } else {
            return
                baseFeeLevel -
                int128((1e6 * _lockedLiquidity) / _liquidityDelta);
        }
    }

    /**
     * @return totalPrice total price scaled by 1e6
     */
    function trade(
        Pool storage _pool,
        uint128 _spot,
        uint128 _price,
        int128 _margin
    ) internal returns (uint128 totalPrice, int128) {
        require(_margin != 0, "TM");

        TradeStateCache memory tradeStateCache = TradeStateCache(
            _pool.tradeState.liquidityDelta,
            _pool.tradeState.liquidityBefore,
            _pool.tradeState.lockedLiquidity,
            0,
            _pool.tradeState.currentFeeLevelIndex,
            0,
            _pool.tradeState.feeLevelMultipliedLiquidityGlobal,
            _pool.tradeState.realizedPnLGlobal
        );

        bool _direction = _margin < 0;
        uint128 remain = LiqMath.abs(_margin);

        while (remain > 0) {
            tradeStateCache.nextFeeLevelIndex = _direction
                ? tradeStateCache.currentFeeLevelIndex - 1
                : tradeStateCache.currentFeeLevelIndex + 1;

            if (tradeStateCache.currentFeeLevel >= 3 * 1e8) {
                revert("OFL");
            }

            if (tradeStateCache.currentFeeLevel <= -3 * 1e8) {
                revert("LFL");
            }

            uint128 targetLiquidity;

            {
                if (_direction) {
                    targetLiquidity = tradeStateCache.lockedLiquidity;
                } else {
                    targetLiquidity =
                        tradeStateCache.liquidityDelta -
                        tradeStateCache.lockedLiquidity;
                }

                // jump if there is no liquidity
                if (targetLiquidity == 0) {
                    _cross(_pool, tradeStateCache, _direction);

                    continue;
                }
            }

            uint128 notionalPerLiquidity = _direction
                ? getUPnL(
                    _pool,
                    _spot,
                    (_price * uint128(1e10 + tradeStateCache.currentFeeLevel)) /
                        1e10,
                    (tradeStateCache.lockedLiquidity *
                        uint128(
                            1e10 +
                                (int128(
                                    2 * tradeStateCache.currentFeeLevelIndex + 1
                                ) * 1e6) /
                                2
                        )) / 1e10,
                    tradeStateCache.lockedLiquidity
                )
                : getRPnL(_pool, tradeStateCache);

            uint128 marginStep = remain;
            int128 deltaH;

            {
                // calculate m

                marginStep = (1e6 * marginStep) / notionalPerLiquidity;

                if (marginStep >= targetLiquidity) {
                    remain = marginStep - targetLiquidity;
                    marginStep = targetLiquidity;
                } else {
                    remain = 0;
                }

                deltaH = int128((marginStep * 1e6) / targetLiquidity);
                if (_direction) {
                    deltaH = -deltaH;
                }

                // update realized PnL
                if (_direction) {
                    tradeStateCache.realizedPnLGlobal +=
                        ((int128(notionalPerLiquidity) - 1e6) *
                            int128(marginStep)) /
                        int128(tradeStateCache.liquidityDelta);
                }
            }

            // calculate price
            {
                uint128 priceInFeeLevel = (_price *
                    (1e10 +
                        (
                            LiqMath.abs(
                                (2 * tradeStateCache.currentFeeLevel + deltaH) *
                                    deltaH
                            )
                        ) /
                        (2 * 1e10))) / 1e12;
                totalPrice +=
                    (marginStep * priceInFeeLevel) /
                    LiqMath.abs(_margin);
            }

            if (_direction) {
                tradeStateCache.lockedLiquidity -= marginStep;
                tradeStateCache.liquidityBefore -= marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal -=
                    (marginStep *
                        uint128(
                            1e10 +
                                (int128(
                                    2 * tradeStateCache.currentFeeLevelIndex + 1
                                ) * 1e6) /
                                2
                        )) /
                    1e10;
            } else {
                tradeStateCache.lockedLiquidity += marginStep;
                tradeStateCache.liquidityBefore += marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal +=
                    (marginStep *
                        uint128(
                            1e10 +
                                (int128(
                                    2 * tradeStateCache.currentFeeLevelIndex + 1
                                ) * 1e6) /
                                2
                        )) /
                    1e10;
            }

            if (
                (_direction &&
                    tradeStateCache.currentFeeLevel <=
                    int128(tradeStateCache.nextFeeLevelIndex) * 1e6) ||
                (!_direction &&
                    tradeStateCache.currentFeeLevel >=
                    int128(tradeStateCache.nextFeeLevelIndex) * 1e6)
            ) {
                _cross(_pool, tradeStateCache, _direction);
            }
        }

        // Update tradeState
        _pool.tradeState = TradeStateLib.TradeState(
            tradeStateCache.liquidityDelta,
            tradeStateCache.liquidityBefore,
            tradeStateCache.lockedLiquidity,
            tradeStateCache.feeLevelMultipliedLiquidityGlobal,
            tradeStateCache.currentFeeLevelIndex,
            tradeStateCache.realizedPnLGlobal
        );

        return (totalPrice, tradeStateCache.currentFeeLevel);
    }

    function _cross(
        Pool storage _pool,
        TradeStateCache memory _cache,
        bool _direction
    ) internal {
        IFeeLevel.Info memory nextFeeLevel = _pool.feeLevels[
            _cache.nextFeeLevelIndex
        ];

        _cache.liquidityDelta = LiqMath.addDelta(
            _cache.liquidityDelta,
            _direction ? -nextFeeLevel.liquidityNet : nextFeeLevel.liquidityNet
        );

        _pool.feeLevels.cross(
            _cache.currentFeeLevelIndex,
            _cache.realizedPnLGlobal
        );

        _cache.lockedLiquidity = 0;
        _cache.currentFeeLevelIndex = _cache.nextFeeLevelIndex;

        _cache.currentFeeLevel = _getCurrentFeeLevel(
            _cache.currentFeeLevelIndex,
            _cache.lockedLiquidity,
            _cache.liquidityDelta
        );

        if (_direction) {
            _cache.lockedLiquidity = _cache.liquidityDelta;
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

        int128 amountPerFeeLevel = _amount / (_feeLevelUpper - _feeLevelLower);
        _pool.feeLevels.update(_feeLevelLower, amountPerFeeLevel);
        _pool.feeLevels.update(_feeLevelUpper, -amountPerFeeLevel);

        position.update(_amount);

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
                getMarkPrice(_poolId, spot),
                pools[_poolId].tradeState.feeLevelMultipliedLiquidityGlobal,
                pools[_poolId].tradeState.liquidityBefore
            );
    }

    /**
     * @notice Calculates collateral's notional value per liquidity
     * @return Notional value per liquidity scaled by 1e6
     */
    function getUPnL(
        Pool storage _pool,
        uint128 _spot,
        uint128 _price,
        uint128 _feeLevelMultipliedByLiquidity,
        uint128 _liquidity
    ) internal view returns (uint128) {
        uint128 weight = (_feeLevelMultipliedByLiquidity * 1e12) /
            (_pool.tradeState.feeLevelMultipliedLiquidityGlobal * _liquidity);

        int128 totalNotional = int128(_pool.tradeState.liquidityBefore) +
            calculateUnrealizedPnL(_pool.id, _spot, _price, weight);

        require(totalNotional > 0, "Insolvency");

        return
            (1e6 * uint128(totalNotional)) / _pool.tradeState.liquidityBefore;
    }

    function getRPnL(Pool storage _pool, TradeStateCache memory _cache)
        internal
        view
        returns (uint128)
    {
        int128 realizedPnLInside = _pool.feeLevels.getFeeGrowthInside(
            _cache.currentFeeLevelIndex,
            _cache.currentFeeLevelIndex + 1,
            _cache.currentFeeLevelIndex,
            _cache.realizedPnLGlobal
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
        uint128 _price,
        uint128 _weight
    ) internal view returns (int128) {
        int128 hedgeNotional = (-int128(_spot) * hedging.pools[_poolId].delta) /
            1e8 -
            Hedging.getEntry(hedging.pools[_poolId], _spot);

        int128 positionNotional = ((int128(_weight) *
            pools[_poolId].entry *
            int128(pools[_poolId].tradeState.liquidityBefore)) /
            1e12 -
            (int128(_price) * positions[_poolId]) /
            1e8);

        return (hedgeNotional + positionNotional) / 1e2;
    }

    /**
     * @notice Calculates perpetual's price multiplied by normalization factor
     */
    function getMarkPrice(uint256 _poolId, uint128 _spot)
        internal
        view
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        uint128 price = getDerivativeIndexPrice(_poolId, _spot);

        int128 currentFeeLevel = getCurrentFeeLevel(pool);

        return (price * uint128(1e10 + currentFeeLevel)) / 1e10;
    }

    function getDerivativeIndexPrice(uint256 _poolId, uint128 _spot)
        internal
        view
        returns (uint128)
    {
        Pool storage pool = pools[_poolId];

        uint128 price = (pool.nfactor * Pricer.calculatePrice(_poolId, _spot)) /
            1e8;

        return price;
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
        int128 pnl = (int128(getMarkPrice(0, _spot)) *
            _traderPosition.size[0] -
            _traderPosition.entry[0] +
            int128(getMarkPrice(1, _spot)) *
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
