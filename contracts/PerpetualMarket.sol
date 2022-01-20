//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ILiquidityPool.sol";
import "./lib/TraderVaultLib.sol";
import "./PerpetualMarketCore.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract
 */
contract PerpetualMarket is ERC20 {
    using TraderVaultLib for TraderVaultLib.TraderPosition;

    uint256 private constant MAX_POOL_ID = 2;

    PerpetualMarketCore private immutable perpetualMarketCore;
    ILiquidityPool private immutable liquidityPool;

    struct TradeParams {
        // Vault Id to hold positions
        uint256 vaultId;
        // Position sizes
        int128[2] sizes;
        // Target collateral ratio
        int128 collateralRatio;
    }

    event Deposited(address indexed account, uint256 issued, uint256 amount);

    event Withdrawn(address indexed account, uint256 burned, uint256 amount);

    event PositionUpdated(address indexed trader, int256 size, int256 totalPrice);

    event Liquidated(address liquidator, uint256 vaultId);

    event Hedged(address hedger, uint256 usdcAmount, uint256 underlyingAmount);

    mapping(address => mapping(uint256 => TraderVaultLib.TraderPosition)) private traders;

    /**
     * @notice initialize Perpetual Market
     */
    constructor(PerpetualMarketCore _perpetualMarketCore, ILiquidityPool _liquidityPool)
        ERC20("Predy V2 LP Token", "PREDY-V2-LP")
    {
        perpetualMarketCore = _perpetualMarketCore;
        liquidityPool = _liquidityPool;
    }

    /**
     * @notice initialize Perpetual Pool
     * @param _depositAmount deposit amount
     * @param _initialFundingRate initial funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external {
        require(_depositAmount > 0 && _initialFundingRate > 0);

        uint256 lpTokenAmount = perpetualMarketCore.initialize(_depositAmount, _initialFundingRate);

        ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), uint128(_depositAmount));

        _mint(msg.sender, _depositAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint128 _depositAmount) external {
        require(_depositAmount > 0);

        uint256 lpTokenAmount = perpetualMarketCore.deposit(_depositAmount);

        ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), uint128(_depositAmount));

        _mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external {
        require(_withdrawnAmount > 0);

        uint256 lpTokenAmount = perpetualMarketCore.withdraw(_withdrawnAmount);

        _burn(msg.sender, lpTokenAmount);

        // Send collateral to msg.sender
        liquidityPool.sendLiquidity(msg.sender, _withdrawnAmount);

        emit Withdrawn(msg.sender, lpTokenAmount, _withdrawnAmount);
    }

    /**
     * @notice Opens new position of the perpetual contracts
     * and manage collaterals in the vault
     * @param _tradeParams trade parameters
     */
    function openPositions(TradeParams memory _tradeParams) public {
        for (uint256 poolId = 0; poolId < MAX_POOL_ID; poolId++) {
            if (_tradeParams.sizes[poolId] != 0) {
                (int128 totalPrice, int128 cumFundingGlobal) = perpetualMarketCore.updatePoolPosition(
                    poolId,
                    _tradeParams.sizes[poolId]
                );

                traders[msg.sender][_tradeParams.vaultId].updatePosition(
                    poolId,
                    _tradeParams.sizes[poolId],
                    totalPrice,
                    cumFundingGlobal
                );

                emit PositionUpdated(msg.sender, _tradeParams.sizes[poolId], totalPrice);
            }
        }

        int128 finalDepositOrWithdrawAmount;

        {
            PerpetualMarketCore.PoolState memory poolState = perpetualMarketCore.getPoolState();
            finalDepositOrWithdrawAmount = traders[msg.sender][_tradeParams.vaultId].depositOrWithdraw(
                _tradeParams.collateralRatio,
                poolState.spot,
                TraderVaultLib.PoolParams(
                    poolState.markPrice0,
                    poolState.markPrice1,
                    poolState.cumFundingFeePerSizeGlobal0,
                    poolState.cumFundingFeePerSizeGlobal1
                )
            );
        }

        if (finalDepositOrWithdrawAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint128(finalDepositOrWithdrawAmount)
            );
        } else {
            liquidityPool.sendLiquidity(msg.sender, uint128(-finalDepositOrWithdrawAmount));
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
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(uint256 _vaultId) external {
        PerpetualMarketCore.PoolState memory poolState = perpetualMarketCore.getPoolState();

        for (uint256 poolId = 0; poolId < MAX_POOL_ID; poolId++) {
            int128 size = traders[msg.sender][_vaultId].size[poolId];

            if (size != 0) {
                perpetualMarketCore.updatePoolPosition(poolId, -size);
            }
        }

        uint128 reward = traders[msg.sender][_vaultId].liquidate(
            poolState.spot,
            TraderVaultLib.PoolParams(
                poolState.markPrice0,
                poolState.markPrice1,
                poolState.cumFundingFeePerSizeGlobal0,
                poolState.cumFundingFeePerSizeGlobal1
            )
        );

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        liquidityPool.sendLiquidity(msg.sender, reward / 2);

        emit Liquidated(msg.sender, _vaultId);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        /// Update variance before hedging
        perpetualMarketCore.updateVariance();

        (bool isLong, uint256 uAmount, uint256 usdcAmount) = perpetualMarketCore.calculateEntryPriceForHedging();

        if (isLong) {
            ERC20(liquidityPool.underlying()).transferFrom(msg.sender, address(liquidityPool), uAmount);
            liquidityPool.sendLiquidity(msg.sender, usdcAmount);
        } else {
            ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), usdcAmount);
            liquidityPool.sendUndrlying(msg.sender, uAmount);
        }

        emit Hedged(msg.sender, usdcAmount, uAmount);
    }

    /**
     * @notice Gets current LP token price
     */
    function getLPTokenPrice() external view returns (uint128) {
        return perpetualMarketCore.getLPTokenPrice();
    }

    /**
     * @notice Gets trade price
     * @param _poolId pool id
     * @param _size positive to get ask price and negatice to get bit price
     */
    function getTradePrice(uint256 _poolId, int128 _size) external view returns (uint128) {
        return perpetualMarketCore.getTradePrice(_poolId, _size);
    }
}
