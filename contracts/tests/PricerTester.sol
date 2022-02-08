//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "../lib/IndexPricer.sol";

/**
 * @title PricerTester
 * @notice Tester contract for Pricer library
 */
contract PricerTester {
    function testCalculatePrice(uint256 _productId, int256 _spotPrice) external pure returns (int256) {
        return IndexPricer.calculateIndexPrice(_productId, _spotPrice);
    }

    function testCalculateDelta(uint256 _productId, int256 _spotPrice) external pure returns (int256) {
        return IndexPricer.calculateDelta(_productId, _spotPrice);
    }
}
