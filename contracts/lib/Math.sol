//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

library Math {
    /// @dev Napier's constant
    int256 internal constant E_E8 = 271828182;
    /// @dev Inverse of Napier's constant (1/e)
    int256 internal constant INV_E_E8 = 36787944;

    function addDelta(uint256 x, int256 y) internal pure returns (uint256 z) {
        if (y < 0) {
            require((z = x - uint256(-y)) < x, "LS");
        } else {
            require((z = x + uint256(y)) >= x, "LA");
        }
    }

    function abs(int256 x) internal pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }

    function max(int256 a, int256 b) internal pure returns (int128) {
        return int128(a > b ? a : b);
    }

    function min(int256 a, int256 b) internal pure returns (int128) {
        return int128(a > b ? b : a);
    }

    function scale(
        uint256 _a,
        uint256 _from,
        uint256 _to
    ) internal pure returns (uint256) {
        if (_from > _to) {
            return _a / 10**(_from - _to);
        } else if (_from < _to) {
            return _a * 10**(_to - _from);
        } else {
            return _a;
        }
    }

    /**
     * @dev Returns log(x) for any positive x.
     */
    function logTaylor(int256 inputE4) internal pure returns (int256 outputE4) {
        require(inputE4 > 1, "input should be positive number");
        int256 inputE8 = inputE4 * 1e4;
        // input x for _logTaylor1 is adjusted to 1/e < x < 1.
        while (inputE8 < INV_E_E8) {
            inputE8 = (inputE8 * E_E8) / 1e8;
            outputE4 -= 1e4;
        }
        while (inputE8 > 1e8) {
            inputE8 = (inputE8 * INV_E_E8) / 1e8;
            outputE4 += 1e4;
        }
        outputE4 += logTaylor1(inputE8 / 1e4 - 1e4);
    }

    /**
     * @notice Calculate an approximate value of the logarithm of input value by
     * Taylor expansion around 1.
     * @dev log(x + 1) = x - 1/2 x^2 + 1/3 x^3 - 1/4 x^4 + 1/5 x^5
     *                     - 1/6 x^6 + 1/7 x^7 - 1/8 x^8 + ...
     */
    function logTaylor1(int256 inputE4) internal pure returns (int256 outputE4) {
        outputE4 =
            inputE4 -
            inputE4**2 /
            (2 * 1e4) +
            inputE4**3 /
            (3 * 1e8) -
            inputE4**4 /
            (4 * 1e12) +
            inputE4**5 /
            (5 * 1e16) -
            inputE4**6 /
            (6 * 1e20) +
            inputE4**7 /
            (7 * 1e24) -
            inputE4**8 /
            (8 * 1e28);
    }
}
