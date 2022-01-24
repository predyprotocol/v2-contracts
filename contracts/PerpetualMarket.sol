//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./interfaces/ILiquidityPool.sol";
import "./lib/TraderVaultLib.sol";
import "./PerpetualMarketCore.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract
 */
contract PerpetualMarket is IPerpetualMarket, ERC20 {
    using TraderVaultLib for TraderVaultLib.TraderVault;

    uint256 private constant MAX_PRODUCT_ID = 2;

    PerpetualMarketCore private immutable perpetualMarketCore;
    ILiquidityPool private immutable liquidityPool;

    event Deposited(address indexed account, uint256 issued, uint256 amount);

    event Withdrawn(address indexed account, uint256 burned, uint256 amount);

    event PositionUpdated(address indexed trader, int256 tradeAmount, int256 totalPrice);

    event Liquidated(address liquidator, address indexed vaultOwner, uint256 vaultId);

    event Hedged(address hedger, uint256 usdcAmount, uint256 underlyingAmount);

    // trader's vaults storage
    mapping(address => mapping(uint256 => TraderVaultLib.TraderVault)) private traderVaults;

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
    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external override {
        require(_depositAmount > 0 && _initialFundingRate > 0);

        uint256 lpTokenAmount = perpetualMarketCore.initialize(_depositAmount, _initialFundingRate);

        ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), uint128(_depositAmount));

        _mint(msg.sender, _depositAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint128 _depositAmount) external override {
        require(_depositAmount > 0);

        uint256 lpTokenAmount = perpetualMarketCore.deposit(_depositAmount);

        ERC20(liquidityPool.collateral()).transferFrom(msg.sender, address(liquidityPool), uint128(_depositAmount));

        _mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external override {
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
    function openPositions(TradeParams memory _tradeParams) public override {
        for (uint256 poolId = 0; poolId < MAX_PRODUCT_ID; poolId++) {
            if (_tradeParams.tradeAmounts[poolId] != 0) {
                (int128 totalPrice, int128 valueFundingFeeEntry) = perpetualMarketCore.updatePoolPosition(
                    poolId,
                    _tradeParams.tradeAmounts[poolId]
                );

                traderVaults[msg.sender][_tradeParams.vaultId].updateVault(
                    poolId,
                    _tradeParams.tradeAmounts[poolId],
                    totalPrice,
                    valueFundingFeeEntry
                );

                emit PositionUpdated(msg.sender, _tradeParams.tradeAmounts[poolId], totalPrice);
            }
        }

        int128 finalDepositOrWithdrawAmount;

        {
            finalDepositOrWithdrawAmount = traderVaults[msg.sender][_tradeParams.vaultId].getAmountRequired(
                _tradeParams.collateralRatio,
                perpetualMarketCore.getPoolState()
            );
            traderVaults[msg.sender][_tradeParams.vaultId].updateUsdcAmount(finalDepositOrWithdrawAmount);
        }

        perpetualMarketCore.updateVariance();

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
        uint256 _productId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external override {
        int128[2] memory tradeAmounts;

        tradeAmounts[_productId] = int128(_size);

        openPositions(TradeParams(_vaultId, tradeAmounts, _depositOrWithdrawAmount));
    }

    /**
     * @notice Open new short position of the perpetual contract
     */
    function openShortPosition(
        uint256 _productId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external override {
        int128[2] memory tradeAmounts;

        tradeAmounts[_productId] = -int128(_size);

        openPositions(TradeParams(_vaultId, tradeAmounts, _depositOrWithdrawAmount));
    }

    /**
     * @notice Liquidate a vault by Pool
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external override {
        PerpetualMarketCore.PoolState memory poolState = perpetualMarketCore.getPoolState();

        for (uint256 poolId = 0; poolId < MAX_PRODUCT_ID; poolId++) {
            int128 amountAssetInVault = traderVaults[_vaultOwner][_vaultId].amountAsset[poolId];

            if (amountAssetInVault != 0) {
                perpetualMarketCore.updatePoolPosition(poolId, -amountAssetInVault);
            }
        }

        uint128 reward = traderVaults[_vaultOwner][_vaultId].liquidate(poolState);

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        liquidityPool.sendLiquidity(msg.sender, reward / 2);

        emit Liquidated(msg.sender, _vaultOwner, _vaultId);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external override {
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
     * @return LP token price scaled by 1e6
     */
    function getLPTokenPrice() external view override returns (uint128) {
        return perpetualMarketCore.getLPTokenPrice();
    }

    /**
     * @notice Gets trade price
     * @param _productId product id
     * @param _size positive to get ask price and negatice to get bit price
     * @return trade price scaled by 1e8
     */
    function getTradePrice(uint256 _productId, int128 _size) external view override returns (int128) {
        return perpetualMarketCore.getTradePrice(_productId, _size);
    }

    /**
     * @notice Gets position value of a vault
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     * @return vault status
     */
    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view override returns (VaultStatus memory) {
        PerpetualMarketCore.PoolState memory poolState = perpetualMarketCore.getPoolState();

        int128 positionValue = traderVaults[_vaultOwner][_vaultId].getPositionValue(poolState);

        int128 minCollateral = traderVaults[_vaultOwner][_vaultId].getMinCollateral(poolState.spotPrice);

        return VaultStatus(positionValue, minCollateral, traderVaults[_vaultOwner][_vaultId]);
    }
}
