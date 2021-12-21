//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ILiquidityPool.sol";

/**
 * @title Liquidity Pool
 * @notice Liquidity Pool Contract
 */
contract LiquidityPool is ILiquidityPool {
    address public immutable override collateral;
    address public immutable override underlying;

    /**
     * @notice initialize liquidity pool
     */
    constructor(address _collateral, address _underlying) {
        collateral = _collateral;
        underlying = _underlying;
    }

    function sendLiquidity(address _recipient, uint256 _amount)
        external
        override
    {
        ERC20(collateral).transfer(_recipient, _amount);
    }

    function sendUndrlying(address _recipient, uint256 _amount)
        external
        override
    {
        ERC20(underlying).transfer(_recipient, _amount);
    }
}
