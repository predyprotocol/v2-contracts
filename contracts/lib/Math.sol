//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * Error codes
 * M0: y is too small
 * M1: y is too large
 * M2: possible overflow
 * M3: input should be positive number
 * M4: cannot handle exponents greater than 100
 */
library Math {
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    /// @dev Min exp
    int256 private constant MIN_EXP = -63 * 1e8;
    /// @dev Max exp
    uint256 private constant MAX_EXP = 100 * 1e8;
    /// @dev ln(2) scaled by 1e8
    uint256 private constant LN_2_E8 = 69314718;

    /**
     * @notice Return the addition of unsigned integer and sigined integer.
     * when y is negative reverting on negative result and when y is positive reverting on overflow.
     */
    function addDelta(uint256 x, int256 y) internal pure returns (uint256 z) {
        if (y < 0) {
            require((z = x - uint256(-y)) < x, "M0");
        } else {
            require((z = x + uint256(y)) >= x, "M1");
        }
    }

    function abs(int256 x) internal pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }

    function max(int256 a, int256 b) internal pure returns (int256) {
        return a > b ? a : b;
    }

    function min(int256 a, int256 b) internal pure returns (int256) {
        return a > b ? b : a;
    }

    /**
     * @notice Returns scaled number.
     * Reverts if the scaler is greater than 50.
     */
    function scale(
        uint256 _a,
        uint256 _from,
        uint256 _to
    ) internal pure returns (uint256) {
        if (_from > _to) {
            require(_from - _to < 70, "M2");
            // (_from - _to) is safe because _from > _to.
            // 10**(_from - _to) is safe because it's less than 10**70.
            return _a.div(10**(_from - _to));
        } else if (_from < _to) {
            require(_to - _from < 70, "M2");
            // (_to - _from) is safe because _to > _from.
            // 10**(_to - _from) is safe because it's less than 10**70.
            return _a.mul(10**(_to - _from));
        } else {
            return _a;
        }
    }

    /**
     * @dev Calculates an approximate value of the logarithm of input value by Halley's method.
     */
    function log(uint256 x) internal pure returns (int256) {
        int256 res;
        int256 next;

        for (uint256 i = 0; i < 8; i++) {
            int256 e = int256(exp(res));
            next = res.add((int256(x).sub(e).mul(2)).mul(1e8).div(int256(x).add(e)));
            if (next == res) {
                break;
            }
            res = next;
        }

        return res;
    }

    /**
     * @dev Returns the exponent of the value using Taylor expansion with support for negative numbers.
     */
    function exp(int256 x) internal pure returns (uint256) {
        if (0 <= x) {
            return exp(uint256(x));
        } else if (x < MIN_EXP) {
            // return 0 because `exp(-63) < 1e-27`
            return 0;
        } else {
            return uint256(1e8).mul(1e8).div(exp(uint256(-x)));
        }
    }

    /**
     * @dev Calculates the exponent of the value using Taylor expansion.
     */
    function exp(uint256 x) internal pure returns (uint256) {
        if (x == 0) {
            return 1e8;
        }
        require(x <= MAX_EXP, "M4");

        uint256 k = floor(x.mul(1e8).div(LN_2_E8)) / 1e8;
        uint256 p = 2**k;
        uint256 r = x.sub(k.mul(LN_2_E8));

        uint256 multiplier = 1e8;

        uint256 lastMultiplier;
        for (uint256 i = 16; i > 0; i--) {
            multiplier = multiplier.mul(r / i).div(1e8).add(1e8);
            if (multiplier == lastMultiplier) {
                break;
            }
            lastMultiplier = multiplier;
        }

        return p.mul(multiplier);
    }

    /**
     * @dev Returns the floor of a 1e8
     */
    function floor(uint256 x) internal pure returns (uint256) {
        return x - (x % 1e8);
    }
}
