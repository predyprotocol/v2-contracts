// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
// Original file is
// https://github.com/predyprotocol/contracts/blob/main/contracts/FeePool.sol

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IFeePool.sol";

contract FeePool is IFeePool, Ownable {
    IERC20 public immutable token;

    constructor(ERC20 _token) {
        token = _token;
    }

    function withdraw(address _recipient, uint256 _amount) external onlyOwner {
        require(_amount > 0);
        token.transfer(_recipient, _amount);
    }

    function sendProfitERC20(address _account, uint256 _amount) external override {
        require(_amount > 0);
        token.transferFrom(_account, address(this), _amount);
    }
}
