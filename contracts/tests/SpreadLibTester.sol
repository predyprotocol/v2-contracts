//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../lib/SpreadLib.sol";

/**
 * @title SpreadLibTester
 * @notice Tester contract for Spread library
 */
contract SpreadLibTester {
    SpreadLib.Info public info;

    function getUpdatedPrice(
        SpreadLib.Info memory _info,
        bool _isLong,
        uint128 _price,
        uint128 _timestamp
    ) external pure returns (uint128 updatedPrice) {
        return SpreadLib.getUpdatedPrice(_info, _isLong, _price, _timestamp);
    }
}
