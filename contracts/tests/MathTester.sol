//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "../lib/Math.sol";

/**
 * @title MathTester
 * @notice Tester contract for Math library
 */
contract MathTester {
    function testAddDelta(uint256 _x, int256 _y) external pure returns (uint256) {
        return Math.addDelta(_x, _y);
    }

    function testScale(
        uint256 _a,
        uint256 _from,
        uint256 _to
    ) external pure returns (uint256) {
        return Math.scale(_a, _from, _to);
    }
}
