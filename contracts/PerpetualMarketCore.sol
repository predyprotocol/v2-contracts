//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./lib/LpPosition.sol";
import "./lib/FeeLevel.sol";
import "./lib/Hedging.sol";
import "./lib/Pricer.sol";
import "./lib/TradeStateLib.sol";
import "./lib/FeeLevelMultipliedLiquidity.sol";

/**
 * @title PerpetualMarket
 * @notice Perpetual Market Contract
 */
contract PerpetualMarketCore {
    using Hedging for Hedging.Info;
    using Hedging for Hedging.PoolInfo;
    using LpPosition for mapping(bytes32 => LpPosition.Info);
    using LpPosition for LpPosition.Info;
    using FeeLevel for mapping(int24 => IFeeLevel.Info);
    using FeeLevel for IFeeLevel.Info;
    using TradeStateLib for TradeStateLib.TradeState;

    struct Pool {
        // The normalization factor of the derivative price, which is reduced by the funding payment
        uint128 nfactor;
        // Cumulative entry price scaled by 1e16
        int128 entry;
        // The timestamp of last trade
        uint128 lastTradeTime;
        mapping(bytes32 => LpPosition.Info) lpPositions;
        mapping(int24 => IFeeLevel.Info) feeLevels;
        TradeStateLib.TradeState tradeState;
    }

    mapping(uint256 => Pool) public pools;

    mapping(uint256 => int128) public positions;

    AggregatorV3Interface private priceFeed;

    Hedging.Info private hedging;

    bool private immutable isFunding;

    address private perpetualMarket;

    modifier onlyPerpetualMarket() {
        require(msg.sender == perpetualMarket);
        _;
    }

    /**
     * @notice initialize perpetual pool
     */
    constructor(address _aggregator, bool _isFunding) {
        priceFeed = AggregatorV3Interface(_aggregator);

        pools[0].nfactor = 1e16;
        pools[1].nfactor = 1e16;

        pools[0].lastTradeTime = uint128(block.timestamp);
        pools[1].lastTradeTime = uint128(block.timestamp);

        isFunding = _isFunding;

        perpetualMarket = msg.sender;
    }

    struct PositionChangeResult {
        uint128 depositAmount;
        uint128 size;
        int128 entryPrice;
    }

    function setPerpetualMarket(address _perpetualMarket) external onlyPerpetualMarket {
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) external onlyPerpetualMarket returns (PositionChangeResult memory posResult) {
        uint128 lockedLiquidity;
        uint128 unlockedLiquidity;
        TradeStateLib.Result memory result;
        {
            TradeStateLib.TradeState storage tradeState = pools[_poolId].tradeState;
            (lockedLiquidity, unlockedLiquidity, result) = tradeState.calculateLockedAndUnlockedLiquidity(
                tradeState.currentFeeLevelIndex,
                _feeLevelLower,
                _feeLevelUpper,
                _amount
            );

            if (lockedLiquidity > 0) {
                posResult.size = uint128(getSRate(_poolId, lockedLiquidity));
            }

            tradeState.update(int128(lockedLiquidity), result, true);
        }

        _updatePosition(pools[_poolId], msg.sender, int128(_amount), _feeLevelLower, _feeLevelUpper);

        if (lockedLiquidity > 0) {
            (uint128 lockedNotional, int128 weight) = calculateLockedNotional(
                _poolId,
                pools[_poolId],
                lockedLiquidity,
                result.levelMultiplied
            );
            posResult.depositAmount += lockedNotional / 1e2;

            posResult.entryPrice = (pools[_poolId].entry * int128(posResult.size)) / positions[_poolId];

            positions[_poolId] += int128(posResult.size);
            pools[_poolId].entry += posResult.entryPrice;

            // after
            posResult.entryPrice = (weight * posResult.entryPrice) / 1e6;

            (uint128 spot, ) = getUnderlyingPrice();
            hedging.addPosition(_poolId, -Pricer.calculateDelta(_poolId, int128(spot)), int128(lockedNotional), spot);
        }

        if (unlockedLiquidity > 0) {
            posResult.depositAmount += calculateUnlockedNotional(
                pools[_poolId],
                _feeLevelLower,
                _feeLevelUpper,
                unlockedLiquidity
            );
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
    ) external onlyPerpetualMarket returns (PositionChangeResult memory posResult) {
        {
            TradeStateLib.TradeState storage tradeState = pools[_poolId].tradeState;
            (uint128 lockedLiquidity, uint128 unlockedLiquidity, TradeStateLib.Result memory result) = tradeState
                .calculateLockedAndUnlockedLiquidity(
                    tradeState.currentFeeLevelIndex,
                    _feeLevelLower,
                    _feeLevelUpper,
                    _amount
                );

            if (lockedLiquidity > 0) {
                posResult.size = uint128(getSRate(_poolId, lockedLiquidity));
            }

            if (lockedLiquidity > 0) {
                _withdraw(_poolId, pools[_poolId], lockedLiquidity, result.levelMultiplied, posResult);
            }

            if (unlockedLiquidity > 0) {
                posResult.depositAmount += calculateUnlockedNotional(
                    pools[_poolId],
                    _feeLevelLower,
                    _feeLevelUpper,
                    unlockedLiquidity
                );
            }

            tradeState.update(-int128(lockedLiquidity), result, false);
        }

        _updatePosition(pools[_poolId], msg.sender, -int128(_amount), _feeLevelLower, _feeLevelUpper);
    }

    function _withdraw(
        uint256 _poolId,
        Pool storage _pool,
        uint128 _lockedLiquidity,
        uint128 _feeLevelMultipliedByLiquidity,
        PositionChangeResult memory posResult
    ) internal {
        uint128 lockedNotional;
        int128 weight;
        (uint128 spot, ) = getUnderlyingPrice();

        {
            int128 hedgeNotional = hedging.pools[_poolId].getHedgeNotional(spot);

            lockedNotional = (_lockedLiquidity * uint128(hedgeNotional)) / (_pool.tradeState.liquidityBefore);

            weight = int128(
                (_feeLevelMultipliedByLiquidity * (_pool.tradeState.liquidityBefore) * 1e6) /
                    (_pool.tradeState.feeLevelMultipliedLiquidityGlobal * _lockedLiquidity)
            );
        }

        posResult.depositAmount += lockedNotional / 1e2;

        posResult.entryPrice = (pools[_poolId].entry * int128(posResult.size)) / positions[_poolId];

        positions[_poolId] -= int128(posResult.size);
        pools[_poolId].entry -= posResult.entryPrice;

        // after
        posResult.entryPrice = (weight * posResult.entryPrice) / 1e6;

        hedging.addPosition(_poolId, -Pricer.calculateDelta(_poolId, int128(spot)), -int128(lockedNotional), spot);
    }

    function calculateLockedNotional(
        uint256 _poolId,
        Pool storage _pool,
        uint128 _lockedLiquidity,
        uint128 _feeLevelMultipliedByLiquidity
    ) internal view returns (uint128, int128) {
        (uint128 spot, ) = getUnderlyingPrice();

        int128 hedgeNotional = hedging.pools[_poolId].getHedgeNotional(spot);

        uint128 lockedNotional = (_lockedLiquidity * uint128(hedgeNotional)) /
            ((_pool.tradeState.liquidityBefore - _lockedLiquidity));

        uint128 weight = (_feeLevelMultipliedByLiquidity * (_pool.tradeState.liquidityBefore) * 1e6) /
            (_pool.tradeState.feeLevelMultipliedLiquidityGlobal * _lockedLiquidity);

        return (lockedNotional, int128(weight));
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
        ) / (_feeLevelUpper - _feeLevelLower);

        return (_unlockedLiquidity * uint128(int128(1e8) + realizedPnL)) / 1e8;
    }

    /**
     * @notice add or remove positions
     * @param _poolId The id of perpetual pool
     * @param _size The size to add or remove.
     * The size is positive for long positions and negative for short positions.
     */
    function addOrRemovePositions(uint256 _poolId, int128 _size) external onlyPerpetualMarket returns (uint128) {
        require(positions[_poolId] + _size >= 0 || _poolId == 1);

        (uint128 spot, ) = getUnderlyingPrice();

        // Calculate margin and price
        int128 totalMargin;

        {
            int128 pos0 = positions[0];
            int128 pos1 = positions[1];
            if (_poolId == 0) {
                pos0 += _size;
            } else if (_poolId == 1) {
                pos1 += _size;
            }
            totalMargin = int128(calculateMargin(_poolId, spot, pos0, pos1));
        }

        uint128 markPrice;
        int128 feeLevel;

        int128 m;

        Pool storage pool = pools[_poolId];
        {
            uint128 price = getDerivativeIndexPrice(_poolId, spot);

            int128 hedgeNotional = hedging.pools[_poolId].getHedgeNotional(spot);
            m = totalMargin - hedgeNotional;

            PnLParams memory pnlParams = PnLParams(
                hedgeNotional,
                pool.entry,
                pool.tradeState.liquidityBefore,
                positions[_poolId]
            );

            (markPrice, feeLevel) = trade(pool, price, m / 1e2, pnlParams);
        }

        positions[_poolId] += _size;

        // Update hedging
        int128 derivativeDelta = Pricer.calculateDelta(_poolId, int128(spot));

        hedging.addPosition(_poolId, -derivativeDelta, m, spot);

        // Update pool info
        int128 totalPrice = (_size * int128(markPrice));

        pool.entry += totalPrice;
        if (isFunding) {
            pool.nfactor = calculateNewNFactor(_poolId, feeLevel);
        }
        pool.lastTradeTime = uint128(block.timestamp);

        return LiqMath.abs(totalPrice);
    }

    /**
     * @notice execute hedging
     */
    function execHedge()
        external
        onlyPerpetualMarket
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

    function getFeeLevel(uint256 _poolId, int24 _feeLevel) external view returns (IFeeLevel.Info memory) {
        return pools[_poolId].feeLevels[_feeLevel];
    }

    //////////////////////////////
    //     Private Functions    //
    //////////////////////////////

    /**
     * @return nfactor scaled by 1e16
     */
    function calculateNewNFactor(uint256 _poolId, int128 _feeLevel) internal view returns (uint128) {
        Pool storage pool = pools[_poolId];

        int128 currentFeeLevel = _feeLevel;

        uint128 fundingFee = (1e12 * (uint128(currentFeeLevel) * uint128(block.timestamp - pool.lastTradeTime))) /
            (1 days * (1e12 + uint128(currentFeeLevel)));

        return (pool.nfactor * (1e12 - fundingFee)) / 1e12;
    }

    /**
     * @return current fee level scaled by 1e8
     */
    function getCurrentFeeLevel(Pool storage _pool) internal view returns (int128) {
        return
            TradeStateLib.getCurrentFeeLevel(
                _pool.tradeState.currentFeeLevelIndex,
                _pool.tradeState.lockedLiquidity,
                _pool.tradeState.liquidityDelta
            );
    }

    /**
     * @return totalPrice total price scaled by 1e8
     */
    function trade(
        Pool storage _pool,
        uint128 _price,
        int128 _margin,
        PnLParams memory _pnlParams
    ) internal returns (uint128 totalPrice, int128) {
        require(_margin != 0, "TM");

        TradeStateLib.TradeStateCache memory tradeStateCache = TradeStateLib.TradeStateCache(
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

            if (tradeStateCache.currentFeeLevel >= 3 * 1e10) {
                revert("OFL");
            }

            if (tradeStateCache.currentFeeLevel <= -3 * 1e10) {
                revert("LFL");
            }

            uint128 targetLiquidity;

            {
                if (_direction) {
                    targetLiquidity = tradeStateCache.lockedLiquidity;
                } else {
                    targetLiquidity = tradeStateCache.liquidityDelta - tradeStateCache.lockedLiquidity;
                }

                // jump if there is no liquidity
                if (targetLiquidity == 0) {
                    tradeStateCache = TradeStateLib.transitionToNextTick(_pool.feeLevels, tradeStateCache, _direction);

                    continue;
                }
            }

            uint128 marginStep = remain;
            int128 deltaH;

            {
                // calculate m
                uint128 notionalPerLiquidity = _direction
                    ? (uint128(_pnlParams.hedgeNotional) * 1e6) / _pnlParams.liquidityBefore
                    : getRPnL(_pool, tradeStateCache);

                marginStep = (1e8 * marginStep) / notionalPerLiquidity;

                if (marginStep >= targetLiquidity) {
                    remain = marginStep - targetLiquidity;
                    marginStep = targetLiquidity;
                } else {
                    remain = 0;
                }

                deltaH = int128((marginStep * 1e8) / targetLiquidity);
                if (_direction) {
                    deltaH = -deltaH;
                }
            }

            // calculate price
            {
                uint128 priceInFeeLevel = (_price *
                    (1e12 + (LiqMath.abs((2 * tradeStateCache.currentFeeLevel + deltaH) * deltaH)) / (2 * 1e12))) /
                    1e12;
                totalPrice += (marginStep * priceInFeeLevel) / LiqMath.abs(_margin);

                // update realized PnL
                if (_direction) {
                    _cumulateRealizedPnL(
                        tradeStateCache,
                        _pool.tradeState,
                        _pnlParams,
                        marginStep,
                        int128(priceInFeeLevel)
                    );
                }
            }

            if (_direction) {
                tradeStateCache.lockedLiquidity -= marginStep;
                tradeStateCache.liquidityBefore -= marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal -= FeeLevelMultipliedLiquidity
                    .calFeeLevelMultipliedLiquidity(marginStep, tradeStateCache.currentFeeLevelIndex);
            } else {
                tradeStateCache.lockedLiquidity += marginStep;
                tradeStateCache.liquidityBefore += marginStep;
                tradeStateCache.feeLevelMultipliedLiquidityGlobal += FeeLevelMultipliedLiquidity
                    .calFeeLevelMultipliedLiquidity(marginStep, tradeStateCache.currentFeeLevelIndex);
            }

            if (marginStep == targetLiquidity) {
                tradeStateCache = TradeStateLib.transitionToNextTick(_pool.feeLevels, tradeStateCache, _direction);
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

    function _cumulateRealizedPnL(
        TradeStateLib.TradeStateCache memory _cache,
        TradeStateLib.TradeState memory _tradeState,
        PnLParams memory _pnlParams,
        uint128 _marginStep,
        int128 _currentPrice
    ) internal pure {
        uint128 upnl = (getUPnL(
            _tradeState.feeLevelMultipliedLiquidityGlobal,
            _currentPrice,
            _pnlParams,
            FeeLevelMultipliedLiquidity.calFeeLevelMultipliedLiquidity(
                _cache.lockedLiquidity,
                _cache.currentFeeLevelIndex
            ),
            _cache.lockedLiquidity
        ) * 1e6) / _pnlParams.liquidityBefore;

        _cache.realizedPnLGlobal += ((int128(upnl) - 1e8) * int128(_marginStep)) / (int128(_cache.liquidityDelta));
    }

    function _updatePosition(
        Pool storage _pool,
        address _provider,
        int128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) internal returns (LpPosition.Info storage) {
        LpPosition.Info storage position = _pool.lpPositions.get(_provider, _feeLevelLower, _feeLevelUpper);

        int128 amountPerFeeLevel = _amount / (_feeLevelUpper - _feeLevelLower);
        _pool.feeLevels.update(_feeLevelLower, amountPerFeeLevel);
        _pool.feeLevels.update(_feeLevelUpper, -amountPerFeeLevel);

        position.update(_amount);

        return position;
    }

    /**
     * @return calculate notional unrealized PnL scaled by 1e8
     */
    function getUnrealizedPnLPerLiquidity(uint256 _poolId) public view returns (uint128) {
        (uint128 spot, ) = getUnderlyingPrice();

        TradeStateLib.TradeState memory tradeState = pools[_poolId].tradeState;

        if (tradeState.liquidityBefore == 0) {
            return 1e8;
        }

        return
            (getUPnL(
                tradeState.feeLevelMultipliedLiquidityGlobal,
                int128(getMarkPrice(_poolId, spot)),
                getPnLParams(_poolId, spot),
                tradeState.feeLevelMultipliedLiquidityGlobal,
                tradeState.liquidityBefore
            ) * 1e6) / tradeState.liquidityBefore;
    }

    function getPnLParams(uint256 _poolId, uint128 _spot) internal view returns (PnLParams memory _pnlParams) {
        return
            PnLParams(
                hedging.pools[_poolId].getHedgeNotional(_spot),
                pools[_poolId].entry,
                pools[_poolId].tradeState.liquidityBefore,
                positions[_poolId]
            );
    }

    /**
     * @notice Calculates collateral's notional value per liquidity
     * @return Notional value per liquidity scaled by 1e8
     */
    function getUPnL(
        uint128 _feeLevelMultipliedLiquidityGlobal,
        int128 _currentPrice,
        PnLParams memory _pnlParams,
        uint128 _feeLevelMultipliedByLiquidity,
        uint128 _liquidity
    ) internal pure returns (uint128) {
        if (_liquidity == 0) {
            return 0;
        }
        uint128 weight = (_feeLevelMultipliedByLiquidity * _pnlParams.liquidityBefore * 1e6) /
            (_feeLevelMultipliedLiquidityGlobal * _liquidity);

        int128 totalNotional = _calculateUnrealizedPnL(_currentPrice, _pnlParams, weight);

        require(totalNotional > 0, "Insolvency");

        return uint128(totalNotional);
    }

    function getRPnL(Pool storage _pool, TradeStateLib.TradeStateCache memory _cache) internal view returns (uint128) {
        int128 realizedPnLInside = _pool.feeLevels.getFeeGrowthInside(
            _cache.currentFeeLevelIndex,
            _cache.currentFeeLevelIndex + 1,
            _cache.currentFeeLevelIndex,
            _cache.realizedPnLGlobal
        );

        return uint128(int128(1e8) + realizedPnLInside);
    }

    /**
     * @notice Calculates position size per liquidity
     * @return Position size for liquidity scaled by 1e8
     */
    function getSRate(uint256 _poolId, uint128 _liquidity) internal view returns (int128) {
        return (int128(_liquidity) * positions[_poolId]) / int128(pools[_poolId].tradeState.liquidityBefore);
    }

    struct PnLParams {
        int128 hedgeNotional;
        int128 entry;
        uint128 liquidityBefore;
        int128 position;
    }

    function _calculateUnrealizedPnL(
        int128 _currentPrice,
        PnLParams memory _params,
        uint128 _weight
    ) internal pure returns (int128) {
        int128 positionNotional = (int128(_weight) * _params.entry) / 1e14 - (_currentPrice * _params.position) / 1e8;

        return (_params.hedgeNotional + positionNotional);
    }

    /**
     * @notice Calculates perpetual's price multiplied by normalization factor
     * @return mark price scaled by 1e8
     */
    function getMarkPrice(uint256 _poolId, uint128 _spot) public view returns (uint128) {
        Pool storage pool = pools[_poolId];

        uint128 price = getDerivativeIndexPrice(_poolId, _spot);

        int128 currentFeeLevel = getCurrentFeeLevel(pool);

        return (price * uint128(1e12 + currentFeeLevel)) / 1e12;
    }

    /**
     * @notice Gets perpetual's index price
     * @return index price scaled by 1e8
     */
    function getDerivativeIndexPrice(uint256 _poolId, uint128 _spot) internal view returns (uint128) {
        Pool storage pool = pools[_poolId];

        uint128 price = (pool.nfactor * Pricer.calculatePrice(_poolId, _spot)) / 1e16;

        return price;
    }

    /**
     * @notice Calculate required margin for delta hedging
     * @return required margin scaled by 1e8
     */
    function calculateMargin(
        uint256 _poolId,
        uint128 _spot,
        int128 _pos0,
        int128 _pos1
    ) internal pure returns (uint128) {
        return (120 * _spot * LiqMath.abs(calculateWeightedDelta(_poolId, int128(_spot), _pos0, _pos1))) / (100 * 1e8);
    }

    function calNetDelta(int128 _spot) internal view returns (int128) {
        int128 delta1 = Pricer.calculateDelta(0, _spot);
        int128 delta2 = Pricer.calculateDelta(1, _spot);

        return positions[0] * delta1 + positions[1] * delta2;
    }

    /**
     * @return weighted delta scaled by 1e8
     */
    function calculateWeightedDelta(
        uint256 _poolId,
        int128 _spot,
        int128 _pos0,
        int128 _pos1
    ) internal pure returns (int128) {
        int128 delta1 = Pricer.calculateDelta(0, _spot);
        int128 delta2 = Pricer.calculateDelta(1, _spot);

        int128 netDelta = _pos0 * delta1 + _pos1 * delta2;
        int128 totalDelta = int128(LiqMath.abs(_pos0 * delta1) + LiqMath.abs(_pos1 * delta2));

        require(totalDelta >= 0, "WD");

        if (totalDelta == 0) {
            return 0;
        }

        if (_poolId == 0) {
            return (_pos0 * delta1 * netDelta) / (1e8 * totalDelta);
        } else if (_poolId == 1) {
            return (_pos1 * delta2 * netDelta) / (1e8 * totalDelta);
        } else {
            revert("NP");
        }
    }

    /**
     * @notice get underlying price scaled by 1e8
     */
    function getUnderlyingPrice() public view returns (uint128, uint256) {
        (, int256 answer, , uint256 roundTimestamp, ) = priceFeed.latestRoundData();

        require(answer > 0, "AN0");

        return (uint128(int128(answer)), roundTimestamp);
    }
}
