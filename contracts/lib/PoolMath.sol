//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./Math.sol";

/**
 * @notice AMM related math library
 */
library PoolMath {
    using SignedSafeMath for int256;
    using SafeCast for int256;

    /**
     * @notice Calculate multiple integral of (m/L)^3.
     * The formula is `(_m^3 + (3/2)*_m^2 * _deltaMargin + _m * _deltaMargin^2 + _deltaMargin^3 / 4) * (_l + _deltaL / 2) / (_l^2 * (_l + _deltaL)^2)`.
     * @param _m required margin
     * @param _deltaMargin difference of required margin
     * @param _l total amount of liquidity
     * @param _deltaL difference of liquidity
     * @return returns result of above formula
     */
    function calculateMarginDivLiquidity(
        int256 _m,
        int256 _deltaMargin,
        int256 _l,
        int256 _deltaL
    ) internal pure returns (int256) {
        require(_l > 0, "l must be positive");

        int256 result = 0;

        result = (_m.mul(_m).mul(_m));

        result = result.add(_m.mul(_m).mul(_deltaMargin).mul(3).div(2));

        result = result.add(_m.mul(_deltaMargin).mul(_deltaMargin));

        result = result.add(_deltaMargin.mul(_deltaMargin).mul(_deltaMargin).div(4));

        result = result.mul(1e8).div(_l).div(_l);

        return result.mul(_l.add(_deltaL.div(2))).mul(1e8).div(_l.add(_deltaL)).div(_l.add(_deltaL));
    }
}
