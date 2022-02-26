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
 */
library Math {
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    /// @dev Napier's constant
    int256 internal constant E_E8 = 271828182;
    /// @dev Inverse of Napier's constant (1/e)
    int256 internal constant INV_E_E8 = 36787944;

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
     * @dev Returns log(x) for any positive x.
     */
    function logTaylor(int256 inputE8) internal pure returns (int256 outputE4) {
        require(inputE8 > 1, "M3");

        // input x for _logTaylor1 is adjusted to 1/e < x < 1.
        while (inputE8 < INV_E_E8) {
            inputE8 = inputE8.mul(E_E8).div(1e8);
            outputE4 = outputE4.sub(1e8);
        }
        while (inputE8 > 1e8) {
            inputE8 = inputE8.mul(INV_E_E8).div(1e8);
            outputE4 = outputE4.add(1e8);
        }
        outputE4 = outputE4.add(logTaylor1(inputE8.sub(1e8)));
    }

    /**
     * @notice Calculate an approximate value of the logarithm of input value by
     * Taylor expansion around 1.
     * @dev log(x + 1) = x - 1/2 x^2 + 1/3 x^3 - 1/4 x^4 + 1/5 x^5
     *                     - 1/6 x^6 + 1/7 x^7 - 1/8 x^8 + ...
     */
    function logTaylor1(int256 inputE8) internal pure returns (int256 outputE4) {
        int256 inputPos = 1;
        for (uint256 i = 0; i < 8; i++) {
            inputPos = inputPos.mul(inputE8);
            if (i % 2 == 0) {
                // i + 1 is safe because it is less than 8
                // ie8**i is safe because it is less than 1e8**8
                outputE4 = outputE4.add(inputPos.div(int256((i + 1).mul(1e8**i))));
            } else {
                outputE4 = outputE4.sub(inputPos.div(int256((i + 1).mul(1e8**i))));
            }
        }
    }
}
