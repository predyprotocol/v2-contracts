// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./MockERC20.sol";
import "../interfaces/IWETH.sol";

/**
 * @notice Mock of WETH contract
 */
contract MockWETH is MockERC20, IWETH {
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) MockERC20(_name, _symbol, _decimals) {}

    fallback() external payable {}

    receive() external payable {}

    function deposit() external payable override {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 value) external override {
        _burn(msg.sender, value);

        (bool success, ) = msg.sender.call{value: value}("");
        require(success, "WETH: ETH transfer failed");
    }
}
