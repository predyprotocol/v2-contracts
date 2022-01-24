//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

library Math {
    function addDelta(uint256 x, int256 y) internal pure returns (uint256 z) {
        if (y < 0) {
            require((z = x - uint256(-y)) < x, "LS");
        } else {
            require((z = x + uint256(y)) >= x, "LA");
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
