//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityPool.sol";

library Pricer {
    /**
     * @return calculated price scaled by 1e8
     */
    function calculateIndexPrice(uint256 _productId, int256 _spot) internal pure returns (int128) {
        if (_productId == 0) {
            return int128((_spot * _spot) / (1e12));
        } else if (_productId == 1) {
            return int128(_spot);
        } else {
            revert("NP");
        }
    }

    /**
     * @return calculated delta scaled by 1e8
     */
    function calculateDelta(uint256 _productId, int256 _spot) internal pure returns (int128) {
        if (_productId == 0) {
            return int128((2 * _spot) / 1e4);
        } else if (_productId == 1) {
            return 1e8;
        } else {
            revert("NP");
        }
    }

    /**
     * @return calculated gamma scaled by 1e8
     */
    function calculateGamma(uint256 _productId) internal pure returns (int128) {
        if (_productId == 0) {
            return 2 * 1e4;
        } else if (_productId == 1) {
            return 0;
        } else {
            revert("NP");
        }
    }
}
