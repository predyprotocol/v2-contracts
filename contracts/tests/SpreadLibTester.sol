//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

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
        int256 _price,
        uint128 _timestamp
    ) external pure returns (int256 updatedPrice) {
        return SpreadLib.getUpdatedPrice(_info, _isLong, _price, _timestamp);
    }
}
