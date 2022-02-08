//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @notice Library contract that has functions to calculate Index price and Greeks of perpetual
 */
library IndexPricer {
    using SignedSafeMath for int256;

    /**
     * @notice Calculates index price of perpetuals
     * Squeeth: ETH^2 / 10000
     * Future: ETH
     * @return calculated index price scaled by 1e8
     */
    function calculateIndexPrice(uint256 _productId, int256 _spot) internal pure returns (int256) {
        if (_productId == 0) {
            return (_spot.mul(_spot)) / (1e12);
        } else if (_productId == 1) {
            return _spot;
        } else {
            revert("NP");
        }
    }

    /**
     * @notice Calculates delta of perpetuals
     * Squeeth: 2 * ETH / 10000
     * Future: 1
     * @return calculated delta scaled by 1e8
     */
    function calculateDelta(uint256 _productId, int256 _spot) internal pure returns (int256) {
        if (_productId == 0) {
            return _spot.mul(2) / 1e4;
        } else if (_productId == 1) {
            return 1e8;
        } else {
            revert("NP");
        }
    }

    /**
     * @notice Calculates gamma of perpetuals
     * Squeeth: 2 / 10000
     * Future: 0
     * @return calculated gamma scaled by 1e8
     */
    function calculateGamma(uint256 _productId) internal pure returns (int256) {
        if (_productId == 0) {
            return 2 * 1e4;
        } else if (_productId == 1) {
            return 0;
        } else {
            revert("NP");
        }
    }
}
