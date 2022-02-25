//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./base/BaseLiquidityPool.sol";
import "./lib/TraderVaultLib.sol";
import "./interfaces/IVaultNFT.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract is entry point of traders and liquidity providers.
 * It manages traders' vault storage and holds funds from traders and liquidity providers.
 *
 * Error Codes
 * PM0: tx exceed deadline
 * PM1: limit price
 * PM2: caller is not vault owner
 */
contract PerpetualMarket is IPerpetualMarket, BaseLiquidityPool, Ownable {
    using SafeCast for int256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;
    using TraderVaultLib for TraderVaultLib.TraderVault;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev liquidation fee is 20%
    int256 private constant LIQUIDATION_FEE = 2000;

    IPerpetualMarketCore private immutable perpetualMarketCore;

    // Fee recepient address
    IFeePool public feeRecepient;

    address private vaultNFT;

    // trader's vaults storage
    mapping(uint256 => TraderVaultLib.TraderVault) private traderVaults;

    event Deposited(address indexed account, uint256 issued, uint256 amount);

    event Withdrawn(address indexed account, uint256 burned, uint256 amount);

    event PositionUpdated(
        address indexed trader,
        uint256 vaultId,
        uint256 subVaultIndex,
        uint256 productId,
        int256 tradeAmount,
        uint256 tradePrice,
        int256 fundingFeePerPosition,
        int256 deltaUsdcPosition
    );
    event DepositedToVault(address indexed trader, uint256 vaultId, uint256 amount);
    event WithdrawnFromVault(address indexed trader, uint256 vaultId, uint256 amount);
    event Liquidated(address liquidator, uint256 indexed vaultId, uint256 reward);

    event Hedged(address hedger, bool isBuyingUnderlying, uint256 usdcAmount, uint256 underlyingAmount);

    event SetFeeRecepient(address feeRecepient);

    /**
     * @notice Constructor of Perpetual Market contract
     */
    constructor(
        address _perpetualMarketCoreAddress,
        address _quoteAsset,
        address _underlyingAsset,
        address _feeRecepient,
        address _vaultNFT
    ) BaseLiquidityPool(_quoteAsset, _underlyingAsset) {
        require(_feeRecepient != address(0));

        perpetualMarketCore = IPerpetualMarketCore(_perpetualMarketCoreAddress);
        feeRecepient = IFeePool(_feeRecepient);
        vaultNFT = _vaultNFT;
    }

    /**
     * @notice Initializes Perpetual Pool
     * @param _depositAmount deposit amount
     * @param _initialFundingRate initial funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external override {
        require(_depositAmount > 0 && _initialFundingRate > 0);

        uint256 lpTokenAmount = perpetualMarketCore.initialize(msg.sender, _depositAmount * 1e2, _initialFundingRate);

        ERC20(quoteAsset).transferFrom(msg.sender, address(this), uint128(_depositAmount));

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint128 _depositAmount) external override {
        require(_depositAmount > 0);

        perpetualMarketCore.executeFundingPayment();

        uint256 lpTokenAmount = perpetualMarketCore.deposit(msg.sender, _depositAmount * 1e2);

        ERC20(quoteAsset).transferFrom(msg.sender, address(this), uint128(_depositAmount));

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external override {
        require(_withdrawnAmount > 0);

        perpetualMarketCore.executeFundingPayment();

        uint256 lpTokenAmount = perpetualMarketCore.withdraw(msg.sender, _withdrawnAmount * 1e2);

        // Send liquidity to msg.sender
        sendLiquidity(msg.sender, _withdrawnAmount);

        emit Withdrawn(msg.sender, lpTokenAmount, _withdrawnAmount);
    }

    /**
     * @notice Opens new positions or closes hold position of the perpetual contracts
     * and manage margin in the vault at the same time.
     * @param _tradeParams trade parameters
     */
    function trade(MultiTradeParams memory _tradeParams) external override {
        // check the transaction not exceed deadline
        require(_tradeParams.deadline == 0 || _tradeParams.deadline >= block.number, "PM0");

        if (_tradeParams.vaultId == 0) {
            // open new vault
            _tradeParams.vaultId = IVaultNFT(vaultNFT).mintNFT(msg.sender);
        } else {
            // check caller is vault owner
            require(IVaultNFT(vaultNFT).ownerOf(_tradeParams.vaultId) == msg.sender, "PM2");
        }

        uint256 totalProtocolFee;

        for (uint256 i = 0; i < _tradeParams.trades.length; i++) {
            totalProtocolFee = totalProtocolFee.add(
                updatePosition(
                    traderVaults[_tradeParams.vaultId],
                    _tradeParams.trades[i].productId,
                    _tradeParams.vaultId,
                    _tradeParams.trades[i].subVaultIndex,
                    _tradeParams.trades[i].tradeAmount,
                    _tradeParams.trades[i].limitPrice
                )
            );
        }

        // Add protocol fee
        if (totalProtocolFee > 0) {
            ERC20(quoteAsset).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }

        int256 finalDepositOrWithdrawAmount;

        finalDepositOrWithdrawAmount = traderVaults[_tradeParams.vaultId].updateUsdcPosition(
            _tradeParams.marginAmount.mul(1e2),
            perpetualMarketCore.getTradePriceInfo(traderVaults[_tradeParams.vaultId].getPositionPerpetuals())
        );

        perpetualMarketCore.updatePoolSnapshot();

        if (finalDepositOrWithdrawAmount > 0) {
            uint256 depositAmount = uint256(finalDepositOrWithdrawAmount / 1e2);
            ERC20(quoteAsset).transferFrom(msg.sender, address(this), depositAmount);
            emit DepositedToVault(msg.sender, _tradeParams.vaultId, depositAmount);
        } else if (finalDepositOrWithdrawAmount < 0) {
            uint256 withdrawAmount = uint256(-finalDepositOrWithdrawAmount) / 1e2;
            sendLiquidity(msg.sender, withdrawAmount);
            emit WithdrawnFromVault(msg.sender, _tradeParams.vaultId, withdrawAmount);
        }
    }

    /**
     * @notice Liquidates a vault by Pool
     * Anyone can liquidate a vault whose PositionValue is less than MinCollateral.
     * The caller gets a portion of the margin as reward.
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(uint256 _vaultId) external override {
        TraderVaultLib.TraderVault storage traderVault = traderVaults[_vaultId];

        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.getPositionPerpetuals()
        );

        // Check if PositionValue is less than MinCollateral or not
        require(traderVault.checkVaultIsLiquidatable(tradePriceInfo), "vault is not danger");

        int256 minCollateral = traderVault.getMinCollateral(tradePriceInfo);

        // Close all positions in the vault
        uint256 totalProtocolFee;
        for (uint256 subVaultIndex = 0; subVaultIndex < traderVault.subVaults.length; subVaultIndex++) {
            for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
                int128 amountAssetInVault = traderVault.subVaults[subVaultIndex].positionPerpetuals[productId];

                totalProtocolFee = totalProtocolFee.add(
                    updatePosition(traderVault, productId, _vaultId, subVaultIndex, -amountAssetInVault, 0)
                );
            }
        }

        traderVault.setInsolvencyFlagIfNeeded();

        uint256 reward = traderVault.decreaseLiquidationReward(minCollateral, LIQUIDATION_FEE);

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        sendLiquidity(msg.sender, reward / (2 * 1e2));

        // Sends protocol fee
        if (totalProtocolFee > 0) {
            ERC20(quoteAsset).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }

        emit Liquidated(msg.sender, _vaultId, reward);
    }

    function updatePosition(
        TraderVaultLib.TraderVault storage _traderVault,
        uint256 _productId,
        uint256 _vaultId,
        uint256 _subVaultIndex,
        int128 _tradeAmount,
        uint256 _limitPrice
    ) internal returns (uint256) {
        if (_tradeAmount != 0) {
            (uint256 tradePrice, int256 fundingFeePerPosition, uint256 protocolFee) = perpetualMarketCore
                .updatePoolPosition(_productId, _tradeAmount);

            require(checkPrice(_tradeAmount > 0, tradePrice, _limitPrice), "PM1");

            int256 deltaUsdcPosition = _traderVault.updateVault(
                _subVaultIndex,
                _productId,
                _tradeAmount,
                tradePrice,
                fundingFeePerPosition
            );

            emit PositionUpdated(
                msg.sender,
                _vaultId,
                _subVaultIndex,
                _productId,
                _tradeAmount,
                tradePrice,
                fundingFeePerPosition,
                deltaUsdcPosition
            );

            return protocolFee / 1e2;
        }
        return 0;
    }

    /**
     * @notice Gets token amount for hedging
     * @return Amount of USDC and underlying reqired for hedging
     */
    function getTokenAmountForHedging()
        external
        view
        override
        returns (
            bool,
            uint256,
            uint256
        )
    {
        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        return (
            completeParams.isLong,
            completeParams.amountUsdc / 1e2,
            Math.scale(completeParams.amountUnderlying, 8, ERC20(underlyingAsset).decimals())
        );
    }

    /**
     * @notice Executes hedging
     */
    function execHedge() external override returns (uint256 amountUsdc, uint256 amountUnderlying) {
        /// Update variance before hedging
        perpetualMarketCore.updatePoolSnapshot();

        // execute funding payment
        perpetualMarketCore.executeFundingPayment();

        // rebalance
        perpetualMarketCore.rebalance();

        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        perpetualMarketCore.completeHedgingProcedure(completeParams);

        amountUsdc = completeParams.amountUsdc / 1e2;
        amountUnderlying = Math.scale(completeParams.amountUnderlying, 8, ERC20(underlyingAsset).decimals());

        if (completeParams.isLong) {
            ERC20(underlyingAsset).transferFrom(msg.sender, address(this), amountUnderlying);
            sendLiquidity(msg.sender, amountUsdc);
        } else {
            ERC20(quoteAsset).transferFrom(msg.sender, address(this), amountUsdc);
            sendUndrlying(msg.sender, amountUnderlying);
        }

        emit Hedged(msg.sender, completeParams.isLong, amountUsdc, amountUnderlying);
    }

    /**
     * @notice Compares trade price and limit price
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
     * @param _deltaLiquidityAmount difference of liquidity
     * If LPs want LP token price of deposit, _deltaLiquidityAmount is positive number of amount to deposit.
     * On the other hand, if LPs want LP token price of withdrawal, _deltaLiquidityAmount is negative number of amount to withdraw.
     * @return LP token price scaled by 1e6
     */
    function getLPTokenPrice(int256 _deltaLiquidityAmount) external view override returns (uint256) {
        return perpetualMarketCore.getLPTokenPrice(_deltaLiquidityAmount);
    }

    /**
     * @notice Gets trade price
     * @param _productId product id
     * @param _tradeAmount amount of position to trade. positive to get long price and negative to get short price.
     * @return trade info
     */
    function getTradePrice(uint256 _productId, int128 _tradeAmount) external view override returns (TradeInfo memory) {
        (
            int256 tradePrice,
            int256 indexPrice,
            int256 fundingRate,
            int256 tradeFee,
            int256 protocolFee
        ) = perpetualMarketCore.getTradePrice(_productId, _tradeAmount);

        return
            TradeInfo(
                tradePrice,
                indexPrice,
                fundingRate,
                tradeFee,
                protocolFee,
                indexPrice.mul(fundingRate).div(1e8),
                tradePrice.toUint256().mul(Math.abs(_tradeAmount)).div(1e8),
                tradeFee.toUint256().mul(Math.abs(_tradeAmount)).div(1e8)
            );
    }

    /**
     * @notice Gets value of min collateral to add positions
     * @param _vaultId The id of target vault
     * @param _tradeAmounts amounts to trade
     * @return minCollateral scaled by 1e6
     */
    function getMinCollateralToAddPosition(uint256 _vaultId, int128[2] memory _tradeAmounts)
        external
        view
        override
        returns (int256 minCollateral)
    {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultId];

        minCollateral = traderVault.getMinCollateralToAddPosition(
            _tradeAmounts,
            perpetualMarketCore.getTradePriceInfo(traderVault.getPositionPerpetuals())
        );

        minCollateral = minCollateral / 1e2;
    }

    /**
     * @notice Gets position value of a vault
     * @param _vaultId The id of target vault
     * @return vault status
     */
    function getVaultStatus(uint256 _vaultId) external view override returns (VaultStatus memory) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultId];

        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.getPositionPerpetuals()
        );

        int256[2][] memory positionValues = new int256[2][](traderVault.subVaults.length);
        int256[2][] memory fundingPaid = new int256[2][](traderVault.subVaults.length);

        for (uint256 i = 0; i < traderVault.subVaults.length; i++) {
            for (uint256 j = 0; j < MAX_PRODUCT_ID; j++) {
                positionValues[i][j] = TraderVaultLib.getPerpetualValueOfSubVault(
                    traderVault.subVaults[i],
                    j,
                    tradePriceInfo
                );
                fundingPaid[i][j] = TraderVaultLib.getFundingFeePaidOfSubVault(
                    traderVault.subVaults[i],
                    j,
                    tradePriceInfo.amountsFundingPaidPerPosition
                );
            }
        }

        return
            VaultStatus(
                traderVault.getPositionValue(tradePriceInfo),
                traderVault.getMinCollateral(tradePriceInfo),
                positionValues,
                fundingPaid,
                traderVault
            );
    }

    /////////////////////////
    //  Admin Functions    //
    /////////////////////////

    /**
     * @notice Sets new fee recepient
     * @param _feeRecepient The address of new fee recepient
     */
    function setFeeRecepient(address _feeRecepient) external onlyOwner {
        require(_feeRecepient != address(0));
        feeRecepient = IFeePool(_feeRecepient);
        emit SetFeeRecepient(_feeRecepient);
    }
}
