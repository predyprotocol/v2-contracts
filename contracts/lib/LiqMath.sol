//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

library LiqMath {
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        if (y < 0) {
            require((z = x - uint128(-y)) < x, "LS");
        } else {
            require((z = x + uint128(y)) >= x, "LA");
        }
    }

    function abs(int128 x) internal pure returns (uint128) {
        return uint128(x >= 0 ? x : -x);
    }

    function max(int128 a, int128 b) internal pure returns (int128) {
        return a > b ? a : b;
    }

    function min(int128 a, int128 b) internal pure returns (int128) {
        return a > b ? b : a;
    }
}
