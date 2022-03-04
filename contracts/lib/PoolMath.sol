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
     * @notice Calculate multiple integral of m/L.
     * The formula is `((_m + _deltaMargin / 2) / _deltaL) * (log(_l + _deltaL) - log(_l))`.
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
        if (_deltaL == 0) {
            return (_m.add(_deltaMargin / 2).mul(1e8)).div(_l);
        } else {
            return (_m.add(_deltaMargin / 2)).mul(Math.log(_l.add(_deltaL).mul(1e8).div(_l).toUint256())).div(_deltaL);
        }
    }
}
