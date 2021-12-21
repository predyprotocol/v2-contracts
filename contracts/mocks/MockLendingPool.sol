// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IAave.sol";

contract MockLendingPool is LendingPool {
    IERC20 public immutable usdc;
    IERC20 public immutable weth;

    uint256 deposited;
    uint256 debt;

    constructor(ERC20 _usdc, ERC20 _weth) {
        usdc = _usdc;
        weth = _weth;
    }

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external override {
        deposited += amount;
        usdc.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external override returns (uint256) {
        uint256 withdrawAmount = amount;

        if (deposited < amount) {
            withdrawAmount = deposited;
        }

        usdc.transfer(msg.sender, withdrawAmount);

        deposited -= withdrawAmount;

        return withdrawAmount;
    }

    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external override {
        debt += amount;
        weth.transfer(msg.sender, amount);
    }

    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external override returns (uint256) {
        uint256 repayAmount = amount;

        if (debt < amount) {
            repayAmount = debt;
        }

        weth.transferFrom(msg.sender, address(this), repayAmount);

        debt -= repayAmount;

        return repayAmount;
    }
}
