//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "../lib/Pricer.sol";

/**
 * @title PricerTester
 * @notice Tester contract for Pricer library
 */
contract PricerTester {
    function testCalculatePrice(uint256 _productId, int256 _spotPrice) external pure returns (int256) {
        return Pricer.calculateIndexPrice(_productId, _spotPrice);
    }

    function testCalculateDelta(uint256 _productId, int256 _spotPrice) external pure returns (int256) {
        return Pricer.calculateDelta(_productId, _spotPrice);
    }
}
