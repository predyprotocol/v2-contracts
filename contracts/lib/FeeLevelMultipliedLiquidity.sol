//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

library FeeLevelMultipliedLiquidity {
    function calFeeLevelMultipliedLiquidity(uint128 _a, int128 _b) internal pure returns (uint128 z) {
        return ((_a * uint128(1e10 + (int128(2 * _b + 1) * 1e6) / 2)) / 1e10);
    }
}
