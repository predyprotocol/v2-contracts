//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title IndexPricer
 * @notice Library contract that has functions to calculate Index price and Greeks of perpetual
 */
library IndexPricer {
    using SignedSafeMath for int256;

    /// @dev Scaling factor for squared index price.
    int256 public constant SCALING_FACTOR = 1e4;

    /**
     * @notice Calculates index price of perpetuals
     * Future: ETH
     * Squeeth: ETH^2 / 10000
     * @return calculated index price scaled by 1e8
     */
    function calculateIndexPrice(uint256 _productId, int256 _spot) internal pure returns (int256) {
        if (_productId == 0) {
            return _spot;
        } else if (_productId == 1) {
            return (_spot.mul(_spot)) / (1e8 * SCALING_FACTOR);
        } else {
            revert("NP");
        }
    }

    /**
     * @notice Calculates delta of perpetuals
     * Future: 1
     * Squeeth: 2 * ETH / 10000
     * @return calculated delta scaled by 1e8
     */
    function calculateDelta(uint256 _productId, int256 _spot) internal pure returns (int256) {
        if (_productId == 0) {
            return 1e8;
        } else if (_productId == 1) {
            return _spot.mul(2) / SCALING_FACTOR;
        } else {
            revert("NP");
        }
    }

    /**
     * @notice Calculates gamma of perpetuals
     * Future: 0
     * Squeeth: 2 / 10000
     * @return calculated gamma scaled by 1e8
     */
    function calculateGamma(uint256 _productId) internal pure returns (int256) {
        if (_productId == 0) {
            return 0;
        } else if (_productId == 1) {
            return 2 * SCALING_FACTOR;
        } else {
            revert("NP");
        }
    }
}
