//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

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

    // trader's vaults storage
    mapping(address => mapping(uint256 => TraderVaultLib.TraderVault)) private traderVaults;

    event Deposited(address indexed account, uint256 issued, uint256 amount);

    event Withdrawn(address indexed account, uint256 burned, uint256 amount);

    event PositionUpdated(
        address indexed trader,
        uint256 vaultId,
        uint256 productId,
        int256 tradeAmount,
        uint256 entryPrice,
        uint256 fundingFeeEntryValuePerSize
    );

    event Liquidated(address liquidator, address indexed vaultOwner, uint256 vaultId);

    event Hedged(address hedger, uint256 usdcAmount, uint256 underlyingAmount, int256[2] deltas);

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
    function openPositions(MultiTradeParams memory _tradeParams) public override {
        // check the transaction not exceed deadline
        require(_tradeParams.deadline == 0 || _tradeParams.deadline >= block.number, "PM0");

        for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
            if (_tradeParams.tradeAmounts[productId] != 0) {
                (int256 totalPrice, int256 valueFundingFeeEntry) = perpetualMarketCore.updatePoolPosition(
                    productId,
                    _tradeParams.tradeAmounts[productId]
                );

                uint256 pricePerSize = uint256(totalPrice / _tradeParams.tradeAmounts[productId]);

                require(
                    checkPrice(
                        _tradeParams.tradeAmounts[productId] > 0,
                        pricePerSize,
                        _tradeParams.limitPrices[productId]
                    ),
                    "PM1"
                );

                traderVaults[msg.sender][_tradeParams.vaultId].updateVault(
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    totalPrice,
                    valueFundingFeeEntry
                );

                emit PositionUpdated(
                    msg.sender,
                    _tradeParams.vaultId,
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    pricePerSize,
                    uint256(valueFundingFeeEntry / _tradeParams.tradeAmounts[productId])
                );
            }
        }

        int256 finalDepositOrWithdrawAmount;

        {
            finalDepositOrWithdrawAmount = traderVaults[msg.sender][_tradeParams.vaultId].getAmountRequired(
                _tradeParams.collateralRatio,
                perpetualMarketCore.getTradePriceInfo(traderVaults[msg.sender][_tradeParams.vaultId].amountAsset)
            );
            traderVaults[msg.sender][_tradeParams.vaultId].updateUsdcAmount(finalDepositOrWithdrawAmount);
        }

        perpetualMarketCore.updateVariance();

        if (finalDepositOrWithdrawAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint256(finalDepositOrWithdrawAmount)
            );
        } else {
            liquidityPool.sendLiquidity(msg.sender, uint256(-finalDepositOrWithdrawAmount));
        }
    }

    /**
     * @notice Open new long position of the perpetual contract
     */
    function openLongPosition(SingleTradeParams memory _tradeParams) external override {
        int128[2] memory tradeAmounts;
        uint256[2] memory limitPrices;

        tradeAmounts[_tradeParams.productId] = int128(_tradeParams.tradeAmount);
        limitPrices[_tradeParams.productId] = _tradeParams.limitPrice;

        openPositions(
            MultiTradeParams(
                _tradeParams.vaultId,
                tradeAmounts,
                _tradeParams.collateralRatio,
                limitPrices,
                _tradeParams.deadline
            )
        );
    }

    /**
     * @notice Open new short position of the perpetual contract
     */
    function openShortPosition(SingleTradeParams memory _tradeParams) external override {
        int128[2] memory tradeAmounts;
        uint256[2] memory limitPrices;

        tradeAmounts[_tradeParams.productId] = -int128(_tradeParams.tradeAmount);
        limitPrices[_tradeParams.productId] = _tradeParams.limitPrice;

        openPositions(
            MultiTradeParams(
                _tradeParams.vaultId,
                tradeAmounts,
                _tradeParams.collateralRatio,
                limitPrices,
                _tradeParams.deadline
            )
        );
    }

    /**
     * @notice Liquidate a vault by Pool
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external override {
        PerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVaults[_vaultOwner][_vaultId].amountAsset
        );

        for (uint256 poolId = 0; poolId < MAX_PRODUCT_ID; poolId++) {
            int128 amountAssetInVault = traderVaults[_vaultOwner][_vaultId].amountAsset[poolId];

            if (amountAssetInVault != 0) {
                perpetualMarketCore.updatePoolPosition(poolId, -amountAssetInVault);
            }
        }

        uint128 reward = traderVaults[_vaultOwner][_vaultId].liquidate(tradePriceInfo);

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        liquidityPool.sendLiquidity(msg.sender, reward / 2);

        emit Liquidated(msg.sender, _vaultOwner, _vaultId);
    }

    /**
     * @notice get token amount for hedging
     * @return amount USDC and amount underlying
     */
    function getTokenAmountForHedging()
        external
        view
        returns (
            bool,
            uint256,
            uint256
        )
    {
        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        return (completeParams.isLong, completeParams.amountUsdc, completeParams.amountUnderlying);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external override {
        /// Update variance before hedging
        perpetualMarketCore.updateVariance();

        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        perpetualMarketCore.calculateEntryPriceForHedging(completeParams);

        if (completeParams.isLong) {
            ERC20(liquidityPool.underlying()).transferFrom(
                msg.sender,
                address(liquidityPool),
                completeParams.amountUnderlying
            );
            liquidityPool.sendLiquidity(msg.sender, completeParams.amountUsdc);
        } else {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                completeParams.amountUsdc
            );
            liquidityPool.sendUndrlying(msg.sender, completeParams.amountUnderlying);
        }

        emit Hedged(msg.sender, completeParams.amountUsdc, completeParams.amountUnderlying, completeParams.deltas);
    }

    /**
     * @notice compare trade price and limit price
     * For long, if trade price is less than limit price then return true.
     * For short, if trade price is greater than limit price then return true.
     * if limit price is 0 then always return true.
     * @param _isLong true if the trade is long and false if the trade is short
     * @param _tradePrice trade price per trade amount
     * @param _limitPrice the worst price the trader accept
     */
    function checkPrice(
        bool _isLong,
        uint256 _tradePrice,
        uint256 _limitPrice
    ) internal pure returns (bool) {
        if (_limitPrice == 0) {
            return true;
        }
        if (_isLong) {
            return _tradePrice <= _limitPrice;
        } else {
            return _tradePrice >= _limitPrice;
        }
    }

    /**
     * @notice Gets current LP token price
     * @return LP token price scaled by 1e6
     */
    function getLPTokenPrice() external view override returns (uint256) {
        return perpetualMarketCore.getLPTokenPrice();
    }

    /**
     * @notice Gets trade price
     * @param _productId product id
     * @param _size positive to get ask price and negatice to get bit price
     * @return trade price scaled by 1e8
     */
    function getTradePrice(uint256 _productId, int128 _size) external view override returns (int256) {
        return perpetualMarketCore.getTradePrice(_productId, _size);
    }

    /**
     * @notice Gets position value of a vault
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     * @return vault status
     */
    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view override returns (VaultStatus memory) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultOwner][_vaultId];

        PerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.amountAsset
        );

        int256[2] memory perpetualValues;
        int256[2] memory fundingPaid;

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            perpetualValues[i] = traderVault.getPerpetualValue(i, tradePriceInfo);
            fundingPaid[i] = traderVault.getFundingFee(i, tradePriceInfo.amountFundingFeesPerSize);
        }

        return
            VaultStatus(
                traderVault.getPositionValue(tradePriceInfo),
                traderVault.getMinCollateral(tradePriceInfo.spotPrice),
                perpetualValues,
                fundingPaid,
                traderVault
            );
    }
}
