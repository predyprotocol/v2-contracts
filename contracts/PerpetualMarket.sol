//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./base/BaseLiquidityPool.sol";
import "./lib/TraderVaultLib.sol";
import "./PerpetualMarketCore.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract
 * The contract manages LP token, that decimal is 6.
 */
contract PerpetualMarket is IPerpetualMarket, ERC20, BaseLiquidityPool, Ownable {
    using SafeCast for int256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;
    using TraderVaultLib for TraderVaultLib.TraderVault;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev liquidation fee
    int256 private liquidationFee;

    PerpetualMarketCore private immutable perpetualMarketCore;
    IFeePool private immutable feeRecepient;

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
        int256 fundingFeePerPosition
    );

    event Liquidated(address liquidator, address indexed vaultOwner, uint256 vaultId);

    event Hedged(
        address hedger,
        bool isBuyingUnderlying,
        uint256 usdcAmount,
        uint256 underlyingAmount,
        int256[2] deltas
    );

    event SetLiquidationFee(int256 liquidationFee);

    /**
     * @notice Constructor of Perpetual Market contract
     */
    constructor(
        PerpetualMarketCore _perpetualMarketCore,
        address _collateral,
        address _underlying,
        address _feeRecepient
    ) ERC20("Predy V2 LP Token", "PREDY-V2-LP") BaseLiquidityPool(_collateral, _underlying) {
        perpetualMarketCore = _perpetualMarketCore;
        feeRecepient = IFeePool(_feeRecepient);

        // The decimals of LP token is 6
        _setupDecimals(6);

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

        _mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint128 _depositAmount) external override {
        require(_depositAmount > 0);

        uint256 lpTokenAmount = perpetualMarketCore.deposit(_depositAmount * 1e2) / 1e2;

        ERC20(collateral).transferFrom(msg.sender, address(this), uint128(_depositAmount));

        _mint(msg.sender, lpTokenAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external override {
        require(_withdrawnAmount > 0);

        uint256 lpTokenAmount = perpetualMarketCore.withdraw(_withdrawnAmount * 1e2) / 1e2;

        _burn(msg.sender, lpTokenAmount);

        // Send collateral to msg.sender
        sendLiquidity(msg.sender, _withdrawnAmount);

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

                traderVaults[msg.sender][_tradeParams.vaultId].updateVault(
                    _tradeParams.subVaultIndex,
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    tradePrice,
                    fundingFeePerPosition
                );

                emit PositionUpdated(
                    msg.sender,
                    _tradeParams.vaultId,
                    productId,
                    _tradeParams.tradeAmounts[productId],
                    tradePrice,
                    fundingFeePerPosition
                );
            }
        }

        int256 finalDepositOrWithdrawAmount;

        if (_tradeParams.collateralRatio > 0) {
            finalDepositOrWithdrawAmount = traderVaults[msg.sender][_tradeParams.vaultId].getAmountRequired(
                _tradeParams.collateralRatio,
                perpetualMarketCore.getTradePriceInfo(
                    traderVaults[msg.sender][_tradeParams.vaultId].getPositionPerpetuals()
                )
            );
            traderVaults[msg.sender][_tradeParams.vaultId].updateUsdcPosition(finalDepositOrWithdrawAmount);
        }

        perpetualMarketCore.updatePoolSnapshot();

        if (finalDepositOrWithdrawAmount > 0) {
            ERC20(collateral).transferFrom(msg.sender, address(this), uint256(finalDepositOrWithdrawAmount / 1e2));
        } else if (finalDepositOrWithdrawAmount < 0) {
            sendLiquidity(msg.sender, uint256(-finalDepositOrWithdrawAmount) / 1e2);
        }

        // Sends protocol fee
        if (totalProtocolFee > 0) {
            ERC20(collateral).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }
    }

    /**
     * @notice Opens new long position of the perpetual contract
     */
    function openLongPosition(SingleTradeParams memory _tradeParams) external override {
        int128[2] memory tradeAmounts;
        uint256[2] memory limitPrices;

        tradeAmounts[_tradeParams.productId] = int128(_tradeParams.tradeAmount);
        limitPrices[_tradeParams.productId] = _tradeParams.limitPrice;

        openPositions(
            MultiTradeParams(
                _tradeParams.vaultId,
                _tradeParams.subVaultIndex,
                tradeAmounts,
                _tradeParams.collateralRatio,
                limitPrices,
                _tradeParams.deadline
            )
        );
    }

    /**
     * @notice Opens new short position of the perpetual contract
     */
    function openShortPosition(SingleTradeParams memory _tradeParams) external override {
        int128[2] memory tradeAmounts;
        uint256[2] memory limitPrices;

        tradeAmounts[_tradeParams.productId] = -int128(_tradeParams.tradeAmount);
        limitPrices[_tradeParams.productId] = _tradeParams.limitPrice;

        openPositions(
            MultiTradeParams(
                _tradeParams.vaultId,
                _tradeParams.subVaultIndex,
                tradeAmounts,
                _tradeParams.collateralRatio,
                limitPrices,
                _tradeParams.deadline
            )
        );
    }

    /**
     * @notice Liquidates a vault by Pool
     * Anyone can liquidata a vault whose PositionValue is less than MinCollateral.
     * The caller gets part of collateral as reward.
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external override {
        TraderVaultLib.TraderVault storage traderVault = traderVaults[_vaultOwner][_vaultId];

        PerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            traderVault.getPositionPerpetuals()
        );

        // Check if PositionValue is less than MinCollateral or not
        require(traderVault.checkVaultIsLiquidatable(tradePriceInfo), "vault is not danger");

        // Close all positions in the vault
        for (uint256 subVaultIndex = 0; subVaultIndex < traderVault.subVaults.length; subVaultIndex++) {
            for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
                int128 amountAssetInVault = traderVault.subVaults[subVaultIndex].positionPerpetuals[productId];

                if (amountAssetInVault != 0) {
                    (uint256 tradePrice, int256 valueFundingFeeEntry, ) = perpetualMarketCore.updatePoolPosition(
                        productId,
                        -amountAssetInVault
                    );

                    traderVault.updateVault(
                        subVaultIndex,
                        productId,
                        -amountAssetInVault,
                        tradePrice,
                        valueFundingFeeEntry
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

        emit Liquidated(msg.sender, _vaultOwner, _vaultId);
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

        emit Hedged(msg.sender, completeParams.isLong, amountUsdc, amountUnderlying, completeParams.deltas);
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
     * @notice Gets min collateral
     * @param _vaultOwner The address of vault owner
     * @param _vaultId The id of target vault
     * @param _tradeAmounts amounts to trade
     * @return min collateral
     */
    function getMinCollateral(
        address _vaultOwner,
        uint256 _vaultId,
        int128[2] memory _tradeAmounts,
        uint256 _spotPrice
    ) external view override returns (int256) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultOwner][_vaultId];

        int128[2] memory positionPerpetuals = traderVault.getPositionPerpetuals();

        for (uint256 i = 0; i < MAX_PRODUCT_ID; i++) {
            positionPerpetuals[i] = positionPerpetuals[i].add(_tradeAmounts[i]).toInt128();
        }

        return TraderVaultLib.calculateMinCollateral(positionPerpetuals, _spotPrice);
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

    function setLiquidationFee(int256 _liquidationFee) external onlyOwner {
        require(_liquidationFee >= 0 && _liquidationFee <= 5000);
        liquidationFee = _liquidationFee;
        emit SetLiquidationFee(liquidationFee);
    }
}
