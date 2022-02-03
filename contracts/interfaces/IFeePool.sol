//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

interface IFeePool {
    function sendProfitERC20(address _account, uint256 _amount) external;
}
