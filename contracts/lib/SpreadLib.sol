//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title SpreadLib
 * @notice Spread Library has functions to controls spread for short-term volatility risk management
 */
library SpreadLib {
    using SafeCast for int256;
    using SafeCast for uint128;

    /// @dev 6 minutes
    uint256 private constant SAFETY_PERIOD = 6 minutes;
    /// @dev 8 bps
    uint256 private constant SPREAD_DECREASE_PER_PERIOD = 8;

    struct Info {
        uint128 askTime;
        int128 minAskPrice;
        uint128 bitTime;
        int128 maxBitPrice;
    }

    function init(Info storage _info) internal {
        _info.minAskPrice = 1e16;
        _info.maxBitPrice = 0;
    }

    /**
     * @notice check and update price to guarantee that
     * max(bit) ≤ min(ask) from some point t to t-Safety Period.
     * @param _isLong trade is long or short
     * @param _price trade price
     * @return adjustedPrice adjusted price
     */
    function checkPrice(
        Info storage _info,
        bool _isLong,
        int128 _price
    ) internal returns (int128 adjustedPrice) {
        Info memory cache = Info(_info.askTime, _info.minAskPrice, _info.bitTime, _info.maxBitPrice);

        adjustedPrice = getUpdatedPrice(cache, _isLong, _price, block.timestamp);

        _info.askTime = cache.askTime;
        _info.minAskPrice = cache.minAskPrice;
        _info.bitTime = cache.bitTime;
        _info.maxBitPrice = cache.maxBitPrice;
    }

    function getUpdatedPrice(
        Info memory _info,
        bool _isLong,
        int128 _price,
        uint256 _timestamp
    ) internal pure returns (int128 adjustedPrice) {
        adjustedPrice = _price;
        if (_isLong) {
            // if long
            if (_info.bitTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice < _info.maxBitPrice) {
                    uint256 tt = (_timestamp - _info.bitTime) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD * tt);
                    if (adjustedPrice <= (_info.maxBitPrice * (1e4 - spreadClosing)) / 1e4) {
                        _info.maxBitPrice = ((_info.maxBitPrice * (1e4 - spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.maxBitPrice;
                }
            }

            // Update min ask
            if (_info.minAskPrice > adjustedPrice || _info.askTime + SAFETY_PERIOD < _timestamp) {
                _info.minAskPrice = adjustedPrice;
            }
            _info.askTime = uint128(_timestamp);
        } else {
            // if short
            if (_info.askTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice > _info.minAskPrice) {
                    uint256 tt = (_timestamp - _info.askTime) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD * tt);
                    if (adjustedPrice <= (_info.minAskPrice * (1e4 + spreadClosing)) / 1e4) {
                        _info.minAskPrice = ((_info.minAskPrice * (1e4 + spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.minAskPrice;
                }
            }

            // Update max bit
            if (_info.maxBitPrice < adjustedPrice || _info.bitTime + SAFETY_PERIOD < _timestamp) {
                _info.maxBitPrice = adjustedPrice;
            }
            _info.bitTime = uint128(_timestamp);
        }
    }
}
