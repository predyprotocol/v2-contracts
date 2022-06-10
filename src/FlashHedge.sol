// SPDX-License-Identifier: agpl-3.0

pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./base/BaseFlashSwap.sol";

/**
 * @title FlashHedge
 * @notice FlashHedge helps to swap underlying assets and USDC tokens with Uniswap for delta hedging.
 * Error codes
 * FH0: no enough usdc amount
 * FH1: no enough usdc amount
 * FH2: profit is less than minUsdc
 * FH3: amounts must not be 0
 * FH4: caller is not bot
 */
contract FlashHedge is BaseFlashSwap, Ownable {
    using SafeERC20 for IERC20;
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;

    address public immutable collateral;
    address public immutable underlying;

    /// @dev ETH:USDC uniswap pool
    address public immutable ethUsdcPool;

    IPerpetualMarket private perpetualMarket;

    /// @dev bot address
    address bot;

    struct FlashHedgeData {
        uint256 amountUsdc;
        uint256 amountUnderlying;
        uint256 minUsdc;
        bool withRebalance;
    }

    enum FLASH_SOURCE {
        FLASH_HEDGE_SELL,
        FLASH_HEDGE_BUY
    }

    event HedgeOnUniswap(address indexed hedger, uint256 hedgeTimestamp, uint256 minUsdc);

    modifier onlyBot() {
        require(msg.sender == bot, "FH4");
        _;
    }

    constructor(
        address _collateral,
        address _underlying,
        address _perpetualMarket,
        address _uniswapFactory,
        address _ethUsdcPool
    ) BaseFlashSwap(_uniswapFactory) {
        require(_collateral != address(0), "invalid collateral address");
        require(_underlying != address(0), "invalid underlying address");
        require(_perpetualMarket != address(0), "invalid perpetual market address");
        require(_ethUsdcPool != address(0), "invalid eth-usdc pool address");
        collateral = _collateral;
        underlying = _underlying;
        perpetualMarket = IPerpetualMarket(_perpetualMarket);
        ethUsdcPool = _ethUsdcPool;

        bot = msg.sender;
    }

    /**
     * @notice uniswap flash swap callback function
     * @dev this function will be called by flashswap callback function uniswapV3SwapCallback()
     * @param _caller address of original function caller
     * @param _amountToPay amount to pay back for flashswap
     * @param _callData arbitrary data attached to callback
     * @param _callSource identifier for which function triggered callback
     */
    function _executeOperation(
        address _caller,
        address, /*_tokenIn*/
        address, /*_tokenOut*/
        uint24, /*_fee*/
        uint256 _amountToPay,
        bytes memory _callData,
        uint8 _callSource
    ) internal override {
        FlashHedgeData memory data = abi.decode(_callData, (FlashHedgeData));

        if (FLASH_SOURCE(_callSource) == FLASH_SOURCE.FLASH_HEDGE_SELL) {
            uint256 amountUsdcToBuyETH = IERC20(collateral).balanceOf(address(this)).sub(data.minUsdc);
            require(amountUsdcToBuyETH >= data.amountUsdc, "FH0");

            IERC20(collateral).approve(address(perpetualMarket), amountUsdcToBuyETH);
            perpetualMarket.execHedge(data.withRebalance, amountUsdcToBuyETH);

            // Repay and safeTransfer profit
            IERC20(underlying).safeTransfer(ethUsdcPool, _amountToPay);
            IERC20(collateral).safeTransfer(_caller, data.minUsdc);
        } else if (FLASH_SOURCE(_callSource) == FLASH_SOURCE.FLASH_HEDGE_BUY) {
            uint256 amountUsdcReceiveFromPredy = _amountToPay.add(data.minUsdc);

            require(data.amountUsdc >= amountUsdcReceiveFromPredy, "FH1");

            IERC20(underlying).approve(address(perpetualMarket), data.amountUnderlying);
            perpetualMarket.execHedge(data.withRebalance, amountUsdcReceiveFromPredy);

            // Repay and safeTransfer profit
            IERC20(collateral).safeTransfer(ethUsdcPool, _amountToPay);
            IERC20(collateral).safeTransfer(_caller, data.minUsdc);
        }
    }

    /**
     * @notice Executes delta hedging by Uniswap
     * @param _minUsdc minimum USDC amount the caller willing to receive
     * @param _withRebalance exec hedge with rebalancing margin or not
     */
    function hedgeOnUniswap(uint256 _minUsdc, bool _withRebalance) external onlyBot {
        (bool isBuyingETH, uint256 amountUsdc, uint256 amountEth) = perpetualMarket.getTokenAmountForHedging();

        require(amountUsdc > 0 && amountEth > 0, "FH3");

        if (isBuyingETH) {
            _exactOutFlashSwap(
                collateral,
                underlying,
                IUniswapV3Pool(ethUsdcPool).fee(),
                amountEth,
                amountUsdc, // max amount of USDC to send
                uint8(FLASH_SOURCE.FLASH_HEDGE_BUY),
                abi.encode(FlashHedgeData(amountUsdc, amountEth, _minUsdc, _withRebalance))
            );
        } else {
            _exactInFlashSwap(
                underlying,
                collateral,
                IUniswapV3Pool(ethUsdcPool).fee(),
                amountEth,
                amountUsdc, // min amount of USDC to receive
                uint8(FLASH_SOURCE.FLASH_HEDGE_SELL),
                abi.encode(FlashHedgeData(amountUsdc, amountEth, _minUsdc, _withRebalance))
            );
        }

        emit HedgeOnUniswap(msg.sender, block.timestamp, _minUsdc);
    }

    /**
     * @notice set bot address
     * @param _bot bot address
     */
    function setBot(address _bot) external onlyOwner {
        bot = _bot;
    }
}
