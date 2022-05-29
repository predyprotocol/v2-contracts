// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

interface IFeePool {
    function sendProfitERC20(address _account, uint256 _amount) external;
}
