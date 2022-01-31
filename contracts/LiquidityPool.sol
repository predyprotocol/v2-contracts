//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ILiquidityPool.sol";

/**
 * @title Liquidity Pool
 * @notice Liquidity Pool Contract
 */
abstract contract LiquidityPool {
    address public immutable collateral;
    address public immutable underlying;

    /**
     * @notice initialize liquidity pool
     */
    constructor(address _collateral, address _underlying) {
        collateral = _collateral;
        underlying = _underlying;
    }

    function sendLiquidity(address _recipient, uint256 _amount) internal {
        ERC20(collateral).transfer(_recipient, _amount);
    }

    function sendUndrlying(address _recipient, uint256 _amount) internal {
        ERC20(underlying).transfer(_recipient, _amount);
    }
}
