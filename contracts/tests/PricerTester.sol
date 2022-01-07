//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/Pricer.sol";

/**
 * @title PricerTester
 * @notice Tester contract for Pricer library
 */
contract PricerTester {
    function testCalculatePrice(uint256 _poolId, uint128 _spot) external pure returns (uint128) {
        return Pricer.calculatePrice(_poolId, _spot);
    }

    function testCalculateDelta(uint256 _poolId, int128 _spot) external pure returns (int128) {
        return Pricer.calculateDelta(_poolId, _spot);
    }
}
