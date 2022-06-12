//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title SpreadLib
 * @notice Spread Library has functions to controls spread for short-term volatility risk management
 */
library SpreadLib {
    using SafeCast for int256;
    using SafeCast for uint128;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int128;

    /// @dev block period for ETH - USD
    uint256 private constant SAFETY_BLOCK_PERIOD = 5;

    /// @dev number of blocks per spread decreasing
    uint256 private constant NUM_BLOCKS_PER_SPREAD_DECREASING = 3;

    struct Info {
        uint128 blockLastLongTransaction;
        int128 minLongTradePrice;
        uint128 blockLastShortTransaction;
        int128 maxShortTradePrice;
        uint256 safetyBlockPeriod;
        uint256 numBlocksPerSpreadDecreasing;
    }

    function init(Info storage _info) internal {
        _info.minLongTradePrice = type(int128).max;
        _info.maxShortTradePrice = 0;
        _info.safetyBlockPeriod = SAFETY_BLOCK_PERIOD;
        _info.numBlocksPerSpreadDecreasing = NUM_BLOCKS_PER_SPREAD_DECREASING;
    }

    function setParams(
        Info storage _info,
        uint256 _safetyBlockPeriod,
        uint256 _numBlocksPerSpreadDecreasing
    ) internal {
        _info.safetyBlockPeriod = _safetyBlockPeriod;
        _info.numBlocksPerSpreadDecreasing = _numBlocksPerSpreadDecreasing;
    }

    /**
     * @notice Checks and updates price to guarantee that
     * max(bit) ≤ min(ask) from some point t to t-Safety Period.
     * @param _isLong trade is long or short
     * @param _price trade price
     * @return adjustedPrice adjusted price
     */
    function checkPrice(
        Info storage _info,
        bool _isLong,
        int256 _price,
        uint256 _blocknumber
    ) internal returns (int256 adjustedPrice) {
        Info memory cache = Info(
            _info.blockLastLongTransaction,
            _info.minLongTradePrice,
            _info.blockLastShortTransaction,
            _info.maxShortTradePrice,
            _info.safetyBlockPeriod,
            _info.numBlocksPerSpreadDecreasing
        );
        // MockArbSys mockArbSys = new MockArbSys();
        adjustedPrice = getUpdatedPrice(cache, _isLong, _price, _blocknumber);

        _info.blockLastLongTransaction = cache.blockLastLongTransaction;
        _info.minLongTradePrice = cache.minLongTradePrice;
        _info.blockLastShortTransaction = cache.blockLastShortTransaction;
        _info.maxShortTradePrice = cache.maxShortTradePrice;
    }

    function getUpdatedPrice(
        Info memory _info,
        bool _isLong,
        int256 _price,
        uint256 _blocknumber
    ) internal pure returns (int256 adjustedPrice) {
        adjustedPrice = _price;
        if (_isLong) {
            // if long
            if (_info.blockLastShortTransaction >= _blocknumber - _info.safetyBlockPeriod) {
                // Within safety period
                if (adjustedPrice < _info.maxShortTradePrice) {
                    int256 spreadClosing = ((_blocknumber - _info.blockLastShortTransaction) /
                        _info.numBlocksPerSpreadDecreasing).toInt256();
                    if (adjustedPrice <= (_info.maxShortTradePrice.mul(1e4 - spreadClosing)) / 1e4) {
                        _info.maxShortTradePrice = ((_info.maxShortTradePrice.mul(1e4 - spreadClosing)) / 1e4)
                            .toInt128();
                    }
                    adjustedPrice = _info.maxShortTradePrice;
                }
            }

            // Update min ask
            if (
                _info.minLongTradePrice > adjustedPrice ||
                _info.blockLastLongTransaction + _info.safetyBlockPeriod < _blocknumber
            ) {
                _info.minLongTradePrice = adjustedPrice.toInt128();
            }
            _info.blockLastLongTransaction = uint128(_blocknumber);
        } else {
            // if short
            if (_info.blockLastLongTransaction >= _blocknumber - _info.safetyBlockPeriod) {
                // Within safety period
                if (adjustedPrice > _info.minLongTradePrice) {
                    int256 spreadClosing = ((_blocknumber - _info.blockLastLongTransaction) /
                        _info.numBlocksPerSpreadDecreasing).toInt256();
                    if (adjustedPrice >= (_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4) {
                        _info.minLongTradePrice = ((_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.minLongTradePrice;
                }
            }

            // Update max bit
            if (
                _info.maxShortTradePrice < adjustedPrice ||
                _info.blockLastShortTransaction + _info.safetyBlockPeriod < _blocknumber
            ) {
                _info.maxShortTradePrice = adjustedPrice.toInt128();
            }
            _info.blockLastShortTransaction = uint128(_blocknumber);
        }
    }
}
