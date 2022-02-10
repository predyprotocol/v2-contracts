//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@uniswap/v3-periphery/contracts/base/Multicall.sol";
import "./interfaces/ILPToken.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./base/BaseLiquidityPool.sol";
import "./lib/TraderVaultLib.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract is entry point of traders and liquidity providers.
 * It manages traders' vault storage and holds funds from traders and liquidity providers.
 */
contract PerpetualMarket is IPerpetualMarket, BaseLiquidityPool, Ownable, Multicall {
    using SafeCast for int256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;
    using TraderVaultLib for TraderVaultLib.TraderVault;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev liquidation fee
    int256 private liquidationFee;

    IPerpetualMarketCore private immutable perpetualMarketCore;

    ILPToken private immutable lpToken;

    // Fee recepient address
    IFeePool public feeRecepient;

    // trader's vaults storage
    mapping(address => mapping(uint256 => TraderVaultLib.TraderVault)) private traderVaults;

    uint256 public cumulativeProtocolFee;

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
    event Liquidated(address liquidator, address indexed vaultOwner, uint256 vaultId, uint256 reward);

    event Hedged(address hedger, bool isBuyingUnderlying, uint256 usdcAmount, uint256 underlyingAmount);

    event SetLiquidationFee(int256 liquidationFee);
    event SetFeeRecepient(address feeRecepient);

    /**
     * @notice Constructor of Perpetual Market contract
     */
    constructor(
        address _perpetualMarketCoreAddress,
        address _lpTokenAddress,
        address _collateral,
        address _underlying,
        address _feeRecepient
    ) BaseLiquidityPool(_collateral, _underlying) {
        require(_collateral != address(0));
        require(_underlying != address(0));
        require(_feeRecepient != address(0));

        perpetualMarketCore = IPerpetualMarketCore(_perpetualMarketCoreAddress);
        lpToken = ILPToken(_lpTokenAddress);
        feeRecepient = IFeePool(_feeRecepient);

        // liquidation fee is 20%
        liquidationFee = 2000;
    }

    /**
     * @notice Initializes Perpetual Pool
     * @param _depositAmount deposit amount
     * @param _initialFundingRate initial funding rate
     */
    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external override {
        require(_depositAmount > 0 && _initialFundingRate > 0);

        uint256 lpTokenAmount = perpetualMarketCore.initialize(_depositAmount * 1e2, _initialFundingRate) / 1e2;

        ERC20(collateral).transferFrom(msg.sender, address(this), uint128(_depositAmount));

        lpToken.mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint128 _depositAmount) external override {
        require(_depositAmount > 0);

        perpetualMarketCore.executeFundingPayment();

        uint256 lpTokenAmount = perpetualMarketCore.deposit(_depositAmount * 1e2) / 1e2;

        ERC20(collateral).transferFrom(msg.sender, address(this), uint128(_depositAmount));

        lpToken.mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external override {
        require(_withdrawnAmount > 0);

        perpetualMarketCore.executeFundingPayment();

        uint256 lpTokenAmount = perpetualMarketCore.withdraw(_withdrawnAmount * 1e2) / 1e2;

        lpToken.burn(msg.sender, lpTokenAmount);

        // Send collateral to msg.sender
        sendLiquidity(msg.sender, _withdrawnAmount);

        emit Withdrawn(msg.sender, lpTokenAmount, _withdrawnAmount);
    }

    /**
     * @notice Opens new positions or closes hold position of the perpetual contracts
     * and manage the collateral in the vault at the same time.
     * @param _tradeParams trade parameters
     */
    function trade(MultiTradeParams memory _tradeParams) public override {
        // check the transaction not exceed deadline
        require(_tradeParams.deadline == 0 || _tradeParams.deadline >= block.number, "PM0");

        uint256 totalProtocolFee;

        for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
            if (_tradeParams.tradeAmounts[productId] != 0) {
                (uint256 tradePrice, int256 fundingFeePerPosition, uint256 protocolFee) = perpetualMarketCore
                    .updatePoolPosition(productId, _tradeParams.tradeAmounts[productId]);

                totalProtocolFee = totalProtocolFee.add(protocolFee / 1e2);

                require(
                    checkPrice(
                        _tradeParams.tradeAmounts[productId] > 0,
                        tradePrice,
                        _tradeParams.limitPrices[productId]
                    ),
                    "PM1"
                );

                int256 deltaUsdcPosition = traderVaults[msg.sender][_tradeParams.vaultId].updateVault(
                    _tradeParams.subVaultIndex,
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    tradePrice,
                    fundingFeePerPosition
                );

                emit PositionUpdated(
                    msg.sender,
                    _tradeParams.vaultId,
                    _tradeParams.subVaultIndex,
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    tradePrice,
                    fundingFeePerPosition,
                    deltaUsdcPosition
                );
            }
        }

        // Add protocol fee
        cumulativeProtocolFee = cumulativeProtocolFee.add(totalProtocolFee);

        int256 finalDepositOrWithdrawAmount;

        finalDepositOrWithdrawAmount = traderVaults[msg.sender][_tradeParams.vaultId].updateUsdcPosition(
            _tradeParams.collateralAmount.mul(1e2),
            perpetualMarketCore.getTradePriceInfo(
                traderVaults[msg.sender][_tradeParams.vaultId].getPositionPerpetuals()
            )
        );

        perpetualMarketCore.updatePoolSnapshot();

        if (finalDepositOrWithdrawAmount > 0) {
            uint256 depositAmount = uint256(finalDepositOrWithdrawAmount / 1e2);
            ERC20(collateral).transferFrom(msg.sender, address(this), depositAmount);
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
     * The caller gets a portion of the collateral as reward.
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external override {
        TraderVaultLib.TraderVault storage traderVault = traderVaults[_vaultOwner][_vaultId];

        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.getPositionPerpetuals()
        );

        // Check if PositionValue is less than MinCollateral or not
        require(traderVault.checkVaultIsLiquidatable(tradePriceInfo), "vault is not danger");

        // Close all positions in the vault
        uint256 totalProtocolFee;
        for (uint256 subVaultIndex = 0; subVaultIndex < traderVault.subVaults.length; subVaultIndex++) {
            for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
                int128 amountAssetInVault = traderVault.subVaults[subVaultIndex].positionPerpetuals[productId];

                if (amountAssetInVault != 0) {
                    (uint256 tradePrice, int256 fundingFeePerPosition, uint256 protocolFee) = perpetualMarketCore
                        .updatePoolPosition(productId, -amountAssetInVault);

                    totalProtocolFee = totalProtocolFee.add(protocolFee / 1e2);

                    int256 deltaUsdcPosition = traderVault.updateVault(
                        subVaultIndex,
                        productId,
                        -amountAssetInVault,
                        tradePrice,
                        fundingFeePerPosition
                    );

                    emit PositionUpdated(
                        msg.sender,
                        _vaultId,
                        subVaultIndex,
                        productId,
                        -amountAssetInVault,
                        tradePrice,
                        fundingFeePerPosition,
                        deltaUsdcPosition
                    );
                }
            }
        }

        traderVault.setInsolvencyFlagIfNeeded();

        uint256 reward = traderVault.decreaseLiquidationReward(liquidationFee);

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        sendLiquidity(msg.sender, reward / (2 * 1e2));

        // Sends protocol fee
        if (totalProtocolFee > 0) {
            ERC20(collateral).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }

        emit Liquidated(msg.sender, _vaultOwner, _vaultId, reward);
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
            Math.scale(completeParams.amountUnderlying, 8, ERC20(underlying).decimals())
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

        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        perpetualMarketCore.completeHedgingProcedure(completeParams);

        amountUsdc = completeParams.amountUsdc / 1e2;
        amountUnderlying = Math.scale(completeParams.amountUnderlying, 8, ERC20(underlying).decimals());

        if (completeParams.isLong) {
            ERC20(underlying).transferFrom(msg.sender, address(this), amountUnderlying);
            sendLiquidity(msg.sender, amountUsdc);
        } else {
            ERC20(collateral).transferFrom(msg.sender, address(this), amountUsdc);
            sendUndrlying(msg.sender, amountUnderlying);
        }

        sendProtocolFee();

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

    function sendProtocolFee() public {
        if (cumulativeProtocolFee > 0) {
            uint256 protocolFee = cumulativeProtocolFee;
            cumulativeProtocolFee = 0;
            ERC20(collateral).approve(address(feeRecepient), protocolFee);
            feeRecepient.sendProfitERC20(address(this), protocolFee);
        }
    }

    /**
     * @notice Gets current LP token price
     * @param _deltaLiquidityAmount difference of liquidity
     * If LPs want LP token price of deposit, _deltaLiquidityAmount is positive number of amount to deposit.
     * On the pther handa, if LPs want LP token price of withdrawal, _deltaLiquidityAmount is negative number of amount to withdraw.
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
     * @notice Gets required collateral
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     * @param _ratio target MinCollateral / PositionValue ratio.
     * @param _tradeAmounts amounts to trade
     * @param _spotPrice spot price if 0 current oracle price will be used
     * @return requiredCollateral and minCollateral
     */
    function getRequiredCollateral(
        address _vaultOwner,
        uint256 _vaultId,
        int256 _ratio,
        int128[2] memory _tradeAmounts,
        uint256 _spotPrice
    ) external view override returns (int256 requiredCollateral, int256 minCollateral) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultOwner][_vaultId];
        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.getPositionPerpetuals()
        );

        (requiredCollateral, minCollateral) = traderVault.getAmountRequired(
            _tradeAmounts,
            _ratio,
            _spotPrice,
            tradePriceInfo
        );

        requiredCollateral = requiredCollateral / 1e2;
        minCollateral = minCollateral / 1e2;
    }

    /**
     * @notice Gets position value of a vault
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     * @return vault status
     */
    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view override returns (VaultStatus memory) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultOwner][_vaultId];

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
                traderVault.getMinCollateral(tradePriceInfo.spotPrice),
                positionValues,
                fundingPaid,
                traderVault
            );
    }

    /////////////////////////
    //  Admin Functions    //
    /////////////////////////

    /**
     * @notice Sets liquidation fee
     * @param _liquidationFee New liquidation fee
     */
    function setLiquidationFee(int256 _liquidationFee) external onlyOwner {
        require(_liquidationFee >= 0 && _liquidationFee <= 5000);
        liquidationFee = _liquidationFee;
        emit SetLiquidationFee(liquidationFee);
    }

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
