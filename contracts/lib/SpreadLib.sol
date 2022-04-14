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
    using SafeMath for uint256;
    using SignedSafeMath for int128;

    /// @dev 6 minutes
    uint256 private constant SAFETY_PERIOD = 6 minutes;
    /// @dev 4 bps
    uint256 private constant SPREAD_DECREASE_PER_PERIOD = 4;
    /// @dev 80 bps
    int256 private constant MAX_SPREAD_DECREASE = 80;

    struct Info {
        uint128 timeLastLongTransaction;
        int128 minLongTradePrice;
        uint128 timeLastShortTransaction;
        int128 maxShortTradePrice;
    }

    function init(Info storage _info) internal {
        _info.minLongTradePrice = type(int128).max;
        _info.maxShortTradePrice = 0;
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
        int256 _price
    ) internal returns (int256 adjustedPrice) {
        Info memory cache = Info(
            _info.timeLastLongTransaction,
            _info.minLongTradePrice,
            _info.timeLastShortTransaction,
            _info.maxShortTradePrice
        );

        adjustedPrice = getUpdatedPrice(cache, _isLong, _price, block.timestamp);

        _info.timeLastLongTransaction = cache.timeLastLongTransaction;
        _info.minLongTradePrice = cache.minLongTradePrice;
        _info.timeLastShortTransaction = cache.timeLastShortTransaction;
        _info.maxShortTradePrice = cache.maxShortTradePrice;
    }

    function getUpdatedPrice(
        Info memory _info,
        bool _isLong,
        int256 _price,
        uint256 _timestamp
    ) internal pure returns (int256 adjustedPrice) {
        adjustedPrice = _price;
        if (_isLong) {
            // if long
            if (_info.timeLastShortTransaction >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice < _info.maxShortTradePrice) {
                    uint256 tt = (_timestamp - _info.timeLastShortTransaction) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD.mul(tt));
                    if (spreadClosing > MAX_SPREAD_DECREASE) {
                        spreadClosing = MAX_SPREAD_DECREASE;
                    }
                    if (adjustedPrice <= (_info.maxShortTradePrice.mul(1e4 - spreadClosing)) / 1e4) {
                        _info.maxShortTradePrice = ((_info.maxShortTradePrice.mul(1e4 - spreadClosing)) / 1e4)
                            .toInt128();
                    }
                    adjustedPrice = _info.maxShortTradePrice;
                }
            }

            // Update min ask
            if (_info.minLongTradePrice > adjustedPrice || _info.timeLastLongTransaction + SAFETY_PERIOD < _timestamp) {
                _info.minLongTradePrice = adjustedPrice.toInt128();
            }
            _info.timeLastLongTransaction = uint128(_timestamp);
        } else {
            // if short
            if (_info.timeLastLongTransaction >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice > _info.minLongTradePrice) {
                    uint256 tt = (_timestamp - _info.timeLastLongTransaction) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD.mul(tt));
                    if (spreadClosing > MAX_SPREAD_DECREASE) {
                        spreadClosing = MAX_SPREAD_DECREASE;
                    }
                    if (adjustedPrice <= (_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4) {
                        _info.minLongTradePrice = ((_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.minLongTradePrice;
                }
            }

            // Update max bit
            if (
                _info.maxShortTradePrice < adjustedPrice || _info.timeLastShortTransaction + SAFETY_PERIOD < _timestamp
            ) {
                _info.maxShortTradePrice = adjustedPrice.toInt128();
            }
            _info.timeLastShortTransaction = uint128(_timestamp);
        }
    }
}
