// SPDX-License-Identifier: GPL-3.0-only

pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IPerpetualMarket.sol";
import "./base/BaseFlashSwap.sol";

/**
 * Error codes
 * FH0: no enough usdc amount
 * FH1: no enough usdc amount
 * FH2: profit is less than minUsdc
 * FH3: amounts must not be 0
 */
contract FlashHedge is BaseFlashSwap {
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;

    address public immutable collateral;
    address public immutable underlying;

    /// @dev ETH:USDC uniswap pool
    address public immutable ethUsdcPool;

    IPerpetualMarket private perpetualMarket;

    struct FlashHedgeData {
        uint256 amountUsdc;
        uint256 amountUnderlying;
        uint256 minUsdc;
    }

    enum FLASH_SOURCE {
        FLASH_HEDGE_SELL,
        FLASH_HEDGE_BUY
    }

    event HedgeOnUniswap(address indexed hedger, uint256 hedgeTimestamp, uint256 minUsdc);

    constructor(
        address _collateral,
        address _underlying,
        address _perpetualMarket,
        address _uniswapFactory,
        address _ethUsdcPool
    ) BaseFlashSwap(_uniswapFactory) {
        collateral = _collateral;
        underlying = _underlying;
        perpetualMarket = IPerpetualMarket(_perpetualMarket);
        ethUsdcPool = _ethUsdcPool;
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
            require(ERC20(collateral).balanceOf(address(this)) >= data.amountUsdc, "FH0");

            ERC20(collateral).approve(address(perpetualMarket), data.amountUsdc);
            perpetualMarket.execHedge();

            // Repay and transfer profit
            uint256 usdcProfit = ERC20(collateral).balanceOf(address(this));

            ERC20(underlying).transfer(ethUsdcPool, _amountToPay);
            ERC20(collateral).transfer(_caller, usdcProfit);

            require(usdcProfit >= data.minUsdc, "FH2");
        } else if (FLASH_SOURCE(_callSource) == FLASH_SOURCE.FLASH_HEDGE_BUY) {
            ERC20(underlying).approve(address(perpetualMarket), data.amountUnderlying);

            (uint256 receivedUsdcAmount, ) = perpetualMarket.execHedge();

            require(receivedUsdcAmount >= _amountToPay, "FH1");

            // Repay and transfer profit
            uint256 usdcProfit = data.amountUsdc.sub(_amountToPay);

            ERC20(collateral).transfer(ethUsdcPool, _amountToPay);
            ERC20(collateral).transfer(_caller, usdcProfit);

            require(usdcProfit >= data.minUsdc, "FH2");
        }
    }

    /**
     * @notice Executes delta hedging by Uniswap
     * @param _minUsdc minimum USDC amount the caller willing to receive
     */
    function hedgeOnUniswap(uint256 _minUsdc) external {
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
                abi.encodePacked(amountUsdc, amountEth, _minUsdc)
            );
        } else {
            _exactInFlashSwap(
                underlying,
                collateral,
                IUniswapV3Pool(ethUsdcPool).fee(),
                amountEth,
                amountUsdc, // min amount of USDC to receive
                uint8(FLASH_SOURCE.FLASH_HEDGE_SELL),
                abi.encodePacked(amountUsdc, amountEth, _minUsdc)
            );
        }

        emit HedgeOnUniswap(msg.sender, block.timestamp, _minUsdc);
    }
}
