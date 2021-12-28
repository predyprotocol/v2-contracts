//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./PerpetualMarket.sol";

/**
 * @title Trade Wrapper
 * @notice Trade Wrapper Contract
 */
contract TradeWrapper {
    PerpetualMarket private immutable perpetualMarket;
    ILiquidityPool private immutable liquidityPool;

    struct TradeParams {
        uint256 vaultId;
        int128[2] sizes;
        int128 depositOrWithdrawAmount;
    }

    /**
     * @notice initialize trade wrapper
     */
    constructor(PerpetualMarket _perpetualMarket, ILiquidityPool _liquidityPool)
    {
        perpetualMarket = _perpetualMarket;
        liquidityPool = _liquidityPool;
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) external {
        uint128 depositAmount = perpetualMarket.deposit(
            _poolId,
            _amount,
            _feeLevelLower,
            _feeLevelUpper
        );

        // Receive collateral from msg.sender
        ERC20(liquidityPool.collateral()).transferFrom(
            msg.sender,
            address(liquidityPool),
            depositAmount
        );
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper
    ) external {
        uint128 withdrawableAmount = perpetualMarket.deposit(
            _poolId,
            _amount,
            _feeLevelLower,
            _feeLevelUpper
        );

        // Send collateral to msg.sender
        liquidityPool.sendLiquidity(msg.sender, withdrawableAmount);
    }

    /**
     * @notice Open new position of the perpetual contract
     */
    function openPositions(TradeParams memory _tradeParams) public {
        uint128 totalPrice0;
        uint128 totalPrice1;

        if (_tradeParams.sizes[0] != 0) {
            totalPrice0 = perpetualMarket.addOrRemovePositions(
                0,
                _tradeParams.sizes[0]
            );

            perpetualMarket.makePositions(
                msg.sender,
                _tradeParams.vaultId,
                0,
                _tradeParams.sizes[0],
                totalPrice0
            );
        }

        if (_tradeParams.sizes[1] != 0) {
            totalPrice1 = perpetualMarket.addOrRemovePositions(
                1,
                _tradeParams.sizes[1]
            );

            perpetualMarket.makePositions(
                msg.sender,
                _tradeParams.vaultId,
                1,
                _tradeParams.sizes[1],
                totalPrice1
            );
        }

        int128 finalDepositOrWithdrawAmount = perpetualMarket.checkIM(
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
        uint128 reward = perpetualMarket.liquidate(
            msg.sender,
            _vaultId,
            _poolId,
            _size
        );

        uint128 totalPrice = perpetualMarket.addOrRemovePositions(
            _poolId,
            _size
        );

        liquidityPool.sendLiquidity(msg.sender, reward);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        (uint256 usdcAmount, uint256 uAmount, bool isLong) = perpetualMarket
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
}
