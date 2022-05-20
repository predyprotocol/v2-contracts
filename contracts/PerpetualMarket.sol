//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
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
 * PM3: vault not found
 * PM4: caller is not hedger
 */
contract PerpetualMarket is IPerpetualMarket, BaseLiquidityPool, Ownable {
    using SafeERC20 for IERC20;
    using SafeCast for int256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SignedSafeMath for int128;
    using TraderVaultLib for TraderVaultLib.TraderVault;

    uint256 private constant MAX_PRODUCT_ID = 2;

    /// @dev liquidation fee is 20%
    int256 private constant LIQUIDATION_FEE = 2000;

    IPerpetualMarketCore private immutable perpetualMarketCore;

    /// @dev hedger address
    address public hedger;

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
        int256 deltaUsdcPosition,
        bytes metadata
    );
    event DepositedToVault(address indexed trader, uint256 vaultId, uint256 amount);
    event WithdrawnFromVault(address indexed trader, uint256 vaultId, uint256 amount);
    event Liquidated(address liquidator, uint256 indexed vaultId, uint256 reward);

    event Hedged(address hedger, bool isBuyingUnderlying, uint256 usdcAmount, uint256 underlyingAmount);

    event SetFeeRecepient(address feeRecepient);

    modifier onlyHedger() {
        require(msg.sender == hedger, "PM4");
        _;
    }

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

        hedger = msg.sender;

        perpetualMarketCore = IPerpetualMarketCore(_perpetualMarketCoreAddress);
        feeRecepient = IFeePool(_feeRecepient);
        vaultNFT = _vaultNFT;
    }

    /**
     * @notice Initializes Perpetual Pool
     * @param _depositAmount deposit amount
     * @param _initialFundingRate initial funding rate
     */
    function initialize(uint256 _depositAmount, int256 _initialFundingRate) external override {
        require(_depositAmount > 0 && _initialFundingRate > 0);

        uint256 lpTokenAmount = perpetualMarketCore.initialize(msg.sender, _depositAmount * 1e2, _initialFundingRate);

        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), _depositAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Provides liquidity to the pool and mints LP tokens
     */
    function deposit(uint256 _depositAmount) external override {
        require(_depositAmount > 0);

        // Funding payment should be proceeded before deposit
        perpetualMarketCore.executeFundingPayment();

        uint256 lpTokenAmount = perpetualMarketCore.deposit(msg.sender, _depositAmount * 1e2);

        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), _depositAmount);

        emit Deposited(msg.sender, lpTokenAmount, _depositAmount);
    }

    /**
     * @notice Withdraws liquidity from the pool and burn LP tokens
     */
    function withdraw(uint128 _withdrawnAmount) external override {
        require(_withdrawnAmount > 0);

        // Funding payment should be proceeded before withdrawal
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

        // funding payment should bee proceeded before trade
        perpetualMarketCore.executeFundingPayment();

        uint256 totalProtocolFee;

        {
            uint256[2] memory tradePrices;
            int256[2] memory fundingPaidPerPositions;

            (tradePrices, fundingPaidPerPositions, totalProtocolFee) = updatePoolPosition(
                getTradeAmounts(_tradeParams.trades),
                getLimitPrices(_tradeParams.trades)
            );

            for (uint256 i = 0; i < _tradeParams.trades.length; i++) {
                updateSubVault(
                    traderVaults[_tradeParams.vaultId],
                    _tradeParams.trades[i].productId,
                    _tradeParams.vaultId,
                    _tradeParams.trades[i].subVaultIndex,
                    tradePrices[_tradeParams.trades[i].productId],
                    fundingPaidPerPositions[_tradeParams.trades[i].productId],
                    _tradeParams.trades[i].tradeAmount,
                    _tradeParams.trades[i].metadata
                );
            }
        }

        // Add protocol fee
        if (totalProtocolFee > 0) {
            IERC20(quoteAsset).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }

        int256 finalDepositOrWithdrawAmount;

        finalDepositOrWithdrawAmount = traderVaults[_tradeParams.vaultId].updateUsdcPosition(
            _tradeParams.marginAmount.mul(1e2),
            perpetualMarketCore.getTradePriceInfo(getTradeAmountsToCloseVaults(traderVaults[_tradeParams.vaultId]))
        );

        // Try to update variance after trade
        perpetualMarketCore.updatePoolSnapshot();

        if (finalDepositOrWithdrawAmount > 0) {
            uint256 depositAmount = uint256(finalDepositOrWithdrawAmount / 1e2);
            IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), depositAmount);
            emit DepositedToVault(msg.sender, _tradeParams.vaultId, depositAmount);
        } else if (finalDepositOrWithdrawAmount < 0) {
            uint256 withdrawAmount = uint256(-finalDepositOrWithdrawAmount) / 1e2;
            sendLiquidity(msg.sender, withdrawAmount);
            emit WithdrawnFromVault(msg.sender, _tradeParams.vaultId, withdrawAmount);
        }
    }

    function getTradeAmounts(TradeParams[] memory _trades) internal pure returns (int256[2] memory tradeAmounts) {
        for (uint256 i = 0; i < _trades.length; i++) {
            tradeAmounts[_trades[i].productId] = tradeAmounts[_trades[i].productId].add(_trades[i].tradeAmount);
        }

        return tradeAmounts;
    }

    function getLimitPrices(TradeParams[] memory _trades) internal pure returns (uint256[2] memory limitPrices) {
        for (uint256 i = 0; i < _trades.length; i++) {
            limitPrices[_trades[i].productId] = _trades[i].limitPrice;
        }

        return limitPrices;
    }

    function getTradeAmountsToCloseVaults(TraderVaultLib.TraderVault memory _traderVault)
        internal
        pure
        returns (int256[2] memory tradeAmounts)
    {
        int128[2] memory positionPerpetuals = _traderVault.getPositionPerpetuals();

        tradeAmounts[0] = -positionPerpetuals[0];
        tradeAmounts[1] = -positionPerpetuals[1];

        return tradeAmounts;
    }

    /**
     * @notice Add margin to the vault
     * @param _vaultId id of the vault
     * @param _marginToAdd amount of margin to add
     */
    function addMargin(uint256 _vaultId, int256 _marginToAdd) external override {
        require(_vaultId > 0 && _vaultId < IVaultNFT(vaultNFT).nextId(), "PM3");

        // increase USDC position
        traderVaults[_vaultId].addUsdcPosition(_marginToAdd.mul(1e2));

        // receive USDC from caller
        uint256 depositAmount = _marginToAdd.toUint256();
        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), depositAmount);

        // emit event
        emit DepositedToVault(msg.sender, _vaultId, depositAmount);
    }

    /**
     * @notice Liquidates a vault by Pool
     * Anyone can liquidate a vault whose PositionValue is less than MinCollateral.
     * The caller gets a portion of the margin as reward.
     * @param _vaultId The id of target vault
     */
    function liquidateByPool(uint256 _vaultId) external override {
        // funding payment should bee proceeded before liquidation
        perpetualMarketCore.executeFundingPayment();

        TraderVaultLib.TraderVault storage traderVault = traderVaults[_vaultId];

        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            getTradeAmountsToCloseVaults(traderVault)
        );

        // Check if PositionValue is less than MinCollateral or not
        require(traderVault.checkVaultIsLiquidatable(tradePriceInfo), "vault is not danger");

        int256 minCollateral = traderVault.getMinCollateral(tradePriceInfo);

        // Close all positions in the vault
        uint256 totalProtocolFee;

        {
            uint256[2] memory tradePrices;
            int256[2] memory fundingPaidPerPositions;

            (tradePrices, fundingPaidPerPositions, totalProtocolFee) = updatePoolPosition(
                getTradeAmountsToCloseVaults(traderVault),
                [uint256(0), uint256(0)]
            );

            for (uint256 subVaultIndex = 0; subVaultIndex < traderVault.subVaults.length; subVaultIndex++) {
                for (uint256 productId = 0; productId < MAX_PRODUCT_ID; productId++) {
                    int128 amountAssetInVault = traderVault.subVaults[subVaultIndex].positionPerpetuals[productId];

                    updateSubVault(
                        traderVault,
                        productId,
                        _vaultId,
                        subVaultIndex,
                        tradePrices[productId],
                        fundingPaidPerPositions[productId],
                        -amountAssetInVault,
                        ""
                    );
                }
            }
        }

        traderVault.setInsolvencyFlagIfNeeded();

        uint256 reward = traderVault.decreaseLiquidationReward(minCollateral, LIQUIDATION_FEE);

        // Sends a half of reward to the pool
        perpetualMarketCore.addLiquidity(reward / 2);

        // Sends a half of reward to the liquidator
        sendLiquidity(msg.sender, reward / (2 * 1e2));

        // Try to update variance after liquidation
        perpetualMarketCore.updatePoolSnapshot();

        // Sends protocol fee
        if (totalProtocolFee > 0) {
            IERC20(quoteAsset).approve(address(feeRecepient), totalProtocolFee);
            feeRecepient.sendProfitERC20(address(this), totalProtocolFee);
        }

        emit Liquidated(msg.sender, _vaultId, reward);
    }

    /**
     * @notice Updates pool position.
     * It returns trade price and fundingPaidPerPosition for each product, and protocol fee.
     */
    function updatePoolPosition(int256[2] memory _tradeAmounts, uint256[2] memory _limitPrices)
        internal
        returns (
            uint256[2] memory tradePrices,
            int256[2] memory fundingPaidPerPositions,
            uint256 protocolFee
        )
    {
        (tradePrices, fundingPaidPerPositions, protocolFee) = perpetualMarketCore.updatePoolPositions(_tradeAmounts);

        require(checkPrice(_tradeAmounts[0] > 0, tradePrices[0], _limitPrices[0]), "PM1");
        require(checkPrice(_tradeAmounts[1] > 0, tradePrices[1], _limitPrices[1]), "PM1");

        protocolFee = protocolFee / 1e2;
    }

    /**
     * @notice Update sub-vault
     */
    function updateSubVault(
        TraderVaultLib.TraderVault storage _traderVault,
        uint256 _productId,
        uint256 _vaultId,
        uint256 _subVaultIndex,
        uint256 _tradePrice,
        int256 _fundingFeePerPosition,
        int128 _tradeAmount,
        bytes memory _metadata
    ) internal {
        if (_tradeAmount == 0) {
            return;
        }
        int256 deltaUsdcPosition = _traderVault.updateVault(
            _subVaultIndex,
            _productId,
            _tradeAmount,
            _tradePrice,
            _fundingFeePerPosition
        );

        emit PositionUpdated(
            msg.sender,
            _vaultId,
            _subVaultIndex,
            _productId,
            _tradeAmount,
            _tradePrice,
            _fundingFeePerPosition,
            deltaUsdcPosition,
            _metadata
        );
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
    function execHedge() external override onlyHedger returns (uint256 amountUsdc, uint256 amountUnderlying) {
        // execute funding payment
        perpetualMarketCore.executeFundingPayment();

        // Try to update variance after funding payment
        perpetualMarketCore.updatePoolSnapshot();

        // rebalance before hedge
        perpetualMarketCore.rebalance();

        NettingLib.CompleteParams memory completeParams = perpetualMarketCore.getTokenAmountForHedging();

        perpetualMarketCore.completeHedgingProcedure(completeParams);

        // rebalance after hedge
        perpetualMarketCore.rebalance();

        amountUsdc = completeParams.amountUsdc / 1e2;
        amountUnderlying = Math.scale(completeParams.amountUnderlying, 8, ERC20(underlyingAsset).decimals());

        if (completeParams.isLong) {
            IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), amountUnderlying);
            sendLiquidity(msg.sender, amountUsdc);
        } else {
            IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), amountUsdc);
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
     * @param _tradeAmounts amount of position to trade. positive to get long price and negative to get short price.
     * @return trade info
     */
    function getTradePrice(uint256 _productId, int256[2] memory _tradeAmounts)
        external
        view
        override
        returns (TradeInfo memory)
    {
        (
            int256 tradePrice,
            int256 indexPrice,
            int256 fundingRate,
            int256 tradeFee,
            int256 protocolFee
        ) = perpetualMarketCore.getTradePrice(_productId, _tradeAmounts);

        return
            TradeInfo(
                tradePrice,
                indexPrice,
                fundingRate,
                tradeFee,
                protocolFee,
                indexPrice.mul(fundingRate).div(1e16),
                tradePrice.toUint256().mul(Math.abs(_tradeAmounts[_productId])).div(1e8),
                tradeFee.toUint256().mul(Math.abs(_tradeAmounts[_productId])).div(1e8)
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
            perpetualMarketCore.getTradePriceInfo(getTradeAmountsToCloseVaults(traderVault))
        );

        minCollateral = minCollateral / 1e2;
    }

    function getTraderVault(uint256 _vaultId) external view override returns (TraderVaultLib.TraderVault memory) {
        return traderVaults[_vaultId];
    }

    /**
     * @notice Gets position value of a vault
     * @param _vaultId The id of target vault
     * @return vault status
     */
    function getVaultStatus(uint256 _vaultId) external view override returns (VaultStatus memory) {
        TraderVaultLib.TraderVault memory traderVault = traderVaults[_vaultId];

        IPerpetualMarketCore.TradePriceInfo memory tradePriceInfo = perpetualMarketCore.getTradePriceInfo(
            getTradeAmountsToCloseVaults(traderVault)
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

    /**
     * @notice set bot address
     * @param _hedger bot address
     */
    function setHedger(address _hedger) external onlyOwner {
        hedger = _hedger;
    }
}
