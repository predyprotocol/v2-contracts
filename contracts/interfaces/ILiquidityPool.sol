//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

interface ILiquidityPool {
    function collateral() external view returns (address);

    function underlying() external view returns (address);

    function sendLiquidity(address _recipient, uint256 _amount) external;

    function sendUndrlying(address _recipient, uint256 _amount) external;
}
