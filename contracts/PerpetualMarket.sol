//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./PerpetualMarketCore.sol";

/**
 * @title Trade Wrapper
 * @notice Trade Wrapper Contract
 */
contract PerpetualMarket {
    PerpetualMarketCore private immutable perpetualMarketCore;
    ILiquidityPool private immutable liquidityPool;

    struct TradeParams {
        uint256 vaultId;
        int128[2] sizes;
        int128 depositOrWithdrawAmount;
    }

    struct DepositParams {
        bool closeSoon;
        uint256 vaultId;
        uint128 depositAmount;
    }

    event Deposited(
        uint256 poolId,
        address _account,
        int24 feeLevelLower,
        int24 feeLevelUpper,
        uint128 issued,
        uint128 amount
    );

    int128 constant MAX_DEPOSIT = 10000000000 * 1e6;

    /**
     * @notice initialize trade wrapper
     */
    constructor(
        PerpetualMarketCore _perpetualMarketCore,
        ILiquidityPool _liquidityPool
    ) {
        perpetualMarketCore = _perpetualMarketCore;
        liquidityPool = _liquidityPool;
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        DepositParams memory _depositParams
    ) external {
        require(_amount > 0);
        checkFeeLevels(_feeLevelLower, _feeLevelUpper);
        PerpetualMarketCore.PositionChangeResult
            memory result = perpetualMarketCore.deposit(
                _poolId,
                _amount,
                _feeLevelLower,
                _feeLevelUpper
            );

        int128 collateralAmount;

        collateralAmount = int128(result.depositAmount);

        if (result.size > 0) {
            perpetualMarketCore.makePositions(
                msg.sender,
                _depositParams.vaultId,
                _poolId,
                int128(result.size),
                ((uint128(result.entryPrice)) / result.size)
            );

            if (_depositParams.closeSoon) {
                uint128 totalPrice0 = perpetualMarketCore.addOrRemovePositions(
                    0,
                    -int128(result.size)
                );

                perpetualMarketCore.makePositions(
                    msg.sender,
                    _depositParams.vaultId,
                    _poolId,
                    -int128(result.size),
                    totalPrice0
                );

                perpetualMarketCore.depositToVault(
                    msg.sender,
                    _depositParams.vaultId,
                    MAX_DEPOSIT
                );
                collateralAmount += MAX_DEPOSIT;

                collateralAmount += perpetualMarketCore.checkIM(
                    msg.sender,
                    _depositParams.vaultId,
                    -MAX_DEPOSIT
                );
            } else {
                perpetualMarketCore.checkIM(
                    msg.sender,
                    _depositParams.vaultId,
                    int128(_depositParams.depositAmount)
                );

                collateralAmount += int128(_depositParams.depositAmount);
            }
        }

        // Receive collateral from msg.sender
        if (collateralAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint128(collateralAmount)
            );
        } else {
            liquidityPool.sendLiquidity(msg.sender, uint128(-collateralAmount));
        }

        emit Deposited(
            _poolId,
            msg.sender,
            _feeLevelLower,
            _feeLevelUpper,
            _amount,
            result.depositAmount
        );
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        uint128 _vaultId,
        uint128 _collateralAmount
    ) external {
        require(_amount > 0);
        checkFeeLevels(_feeLevelLower, _feeLevelUpper);
        PerpetualMarketCore.PositionChangeResult
            memory result = perpetualMarketCore.withdraw(
                _poolId,
                _amount,
                _feeLevelLower,
                _feeLevelUpper
            );

        if (result.size > 0) {
            perpetualMarketCore.makePositions(
                msg.sender,
                _vaultId,
                _poolId,
                -int128(result.size),
                (uint128(result.entryPrice)) / result.size
            );

            perpetualMarketCore.checkIM(
                msg.sender,
                _vaultId,
                int128(_collateralAmount)
            );
        }

        // Send collateral to msg.sender
        liquidityPool.sendLiquidity(
            msg.sender,
            result.depositAmount - _collateralAmount
        );
    }

    /**
     * @notice Open new position of the perpetual contract
     */
    function openPositions(TradeParams memory _tradeParams) public {
        uint128 totalPrice0;
        uint128 totalPrice1;

        if (_tradeParams.sizes[0] != 0) {
            totalPrice0 = perpetualMarketCore.addOrRemovePositions(
                0,
                _tradeParams.sizes[0]
            );

            perpetualMarketCore.makePositions(
                msg.sender,
                _tradeParams.vaultId,
                0,
                _tradeParams.sizes[0],
                totalPrice0
            );
        }

        if (_tradeParams.sizes[1] != 0) {
            totalPrice1 = perpetualMarketCore.addOrRemovePositions(
                1,
                _tradeParams.sizes[1]
            );

            perpetualMarketCore.makePositions(
                msg.sender,
                _tradeParams.vaultId,
                1,
                _tradeParams.sizes[1],
                totalPrice1
            );
        }

        int128 finalDepositOrWithdrawAmount = perpetualMarketCore.checkIM(
            msg.sender,
            _tradeParams.vaultId,
            _tradeParams.depositOrWithdrawAmount
        );

        if (finalDepositOrWithdrawAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint128(finalDepositOrWithdrawAmount)
            );
        } else {
            liquidityPool.sendLiquidity(
                msg.sender,
                uint128(-finalDepositOrWithdrawAmount)
            );
        }
    }

    /**
     * @notice Open new long position of the perpetual contract
     */
    function openLongPosition(
        uint256 _poolId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external {
        int128[2] memory sizes;

        sizes[_poolId] = int128(_size);

        openPositions(TradeParams(_vaultId, sizes, _depositOrWithdrawAmount));
    }

    /**
     * @notice Open new short position of the perpetual contract
     */
    function openShortPosition(
        uint256 _poolId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external {
        int128[2] memory sizes;

        sizes[_poolId] = -int128(_size);

        openPositions(TradeParams(_vaultId, sizes, _depositOrWithdrawAmount));
    }

    /**
     * @notice Liquidate a vault by Pool
     */
    function liquidateByPool(
        uint256 _poolId,
        uint256 _vaultId,
        int128 _size
    ) external {
        uint128 reward = perpetualMarketCore.liquidate(
            msg.sender,
            _vaultId,
            _poolId,
            _size
        );

        uint128 totalPrice = perpetualMarketCore.addOrRemovePositions(
            _poolId,
            _size
        );

        liquidityPool.sendLiquidity(msg.sender, reward);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        (uint256 usdcAmount, uint256 uAmount, bool isLong) = perpetualMarketCore
            .execHedge();

        if (isLong) {
            ERC20(liquidityPool.underlying()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uAmount
            );
            liquidityPool.sendLiquidity(msg.sender, usdcAmount);
        } else {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                usdcAmount
            );
            liquidityPool.sendUndrlying(msg.sender, uAmount);
        }
    }

    function checkFeeLevels(int24 _levelLower, int24 _levelUpper)
        internal
        pure
    {
        require(_levelLower < _levelUpper, "FLU");
        require(_levelLower >= 0, "FLM");
        require(_levelUpper <= 300, "FUM");
    }
}
