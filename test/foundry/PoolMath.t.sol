//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "forge-std/Test.sol";

import "../../src/lib/PoolMath.sol";

/**
 * @title PoolMathTester
 * @notice Tester contract for PoolMath library
 */
contract PoolMathTest is Test {
    using SignedSafeMath for int256;

    function testCalculateFundingRateFormula(
        int256 _m,
        int256 _deltaMargin,
        int256 _l,
        int256 _deltaL
    ) external pure returns (int256) {
        return PoolMath.calculateFundingRateFormula(_m, _deltaMargin, _l, _deltaL);
    }
}
