//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

interface ILPToken {
    function mint(address _account, uint256 _amount) external;

    function burn(address _account, uint256 _amount) external;
}
