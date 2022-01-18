//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ILiquidityPool.sol";
import "./interfaces/IPerpetualMarketCore.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract
 */
contract PerpetualMarket is ERC20 {
    IPerpetualMarketCore private immutable perpetualMarketCore;
    ILiquidityPool private immutable liquidityPool;

    struct TradeParams {
        uint256 vaultId;
        int128[2] sizes;
        int128 collateralRatio;
    }

    event Deposited(address indexed account, uint256 issued, uint256 amount);

    event Withdrawn(address indexed account, uint256 burned, uint256 amount);

    event PositionUpdated(address trader, int256 size, uint256 totalPrice);

    event Liquidated(address liquidator, uint256 vaultId);

    event Hedged(address hedger, uint256 usdcAmount, uint256 underlyingAmount);

    int128 private constant IM_RATIO = 1e8;

    /**
     * @notice initialize Perpetual Market
     */
    constructor(IPerpetualMarketCore _perpetualMarketCore, ILiquidityPool _liquidityPool)
        ERC20("Predy V2 LP Token", "PREDY-V2-LP")
    {
        perpetualMarketCore = _perpetualMarketCore;
        liquidityPool = _liquidityPool;
    }

    function initialize(uint256 _depositAmount, uint256 _fundingRate) external {
        require(_depositAmount > 0 && _fundingRate > 0);

        uint256 lpTokenAmount;

        _mint(msg.sender, _depositAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint256 _depositAmount) external {
        require(_depositAmount > 0);

        uint256 lpTokenAmount;

        ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), uint128(_depositAmount));

        _mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(uint256 _withdrawnAmount) external {
        require(_withdrawnAmount > 0);

        uint256 lpTokenAmount;

        _burn(msg.sender, lpTokenAmount);

        // Send collateral to msg.sender
        liquidityPool.sendLiquidity(msg.sender, _withdrawnAmount);

        emit Withdrawn(msg.sender, lpTokenAmount, _withdrawnAmount);
    }

    /**
     * @notice Open new position of the perpetual contract
     */
    function openPositions(TradeParams memory _tradeParams) public {}

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
        emit Liquidated(msg.sender, _vaultId);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        uint256 usdcAmount;
        uint256 uAmount;
        bool isLong;

        if (isLong) {
            ERC20(liquidityPool.underlying()).transferFrom(msg.sender, address(liquidityPool), uAmount);
            liquidityPool.sendLiquidity(msg.sender, usdcAmount);
        } else {
            ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), usdcAmount);
            liquidityPool.sendUndrlying(msg.sender, uAmount);
        }

        emit Hedged(msg.sender, usdcAmount, uAmount);
    }
}
