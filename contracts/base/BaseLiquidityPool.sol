// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Base Liquidity Pool
 * @notice Base Liquidity Pool Contract
 */
abstract contract BaseLiquidityPool {
    address public immutable quoteAsset;
    address public immutable underlyingAsset;

    /**
     * @notice initialize liquidity pool
     */
    constructor(address _quoteAsset, address _underlyingAsset) {
        require(_quoteAsset != address(0));
        require(_underlyingAsset != address(0));

        quoteAsset = _quoteAsset;
        underlyingAsset = _underlyingAsset;
    }

    function sendLiquidity(address _recipient, uint256 _amount) internal {
        ERC20(quoteAsset).transfer(_recipient, _amount);
    }

    function sendUndrlying(address _recipient, uint256 _amount) internal {
        ERC20(underlyingAsset).transfer(_recipient, _amount);
    }
}
