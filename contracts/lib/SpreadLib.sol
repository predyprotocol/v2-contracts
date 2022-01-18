//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

/**
 * @title SpreadLib
 */
library SpreadLib {
    /// @dev 6 minutes
    uint128 constant SAFETY_PERIOD = 6 minutes;
    /// @dev 8 bps
    uint128 constant SPREAD_DECREASE_PER_PERIOD = 8;

    struct Info {
        uint128 askTime;
        uint128 minAskPrice;
        uint128 bitTime;
        uint128 maxBitPrice;
    }

    /**
     * check and update price to guarantee that
     * max(bit) ≤ min(ask) from some point t to t-Safety Period.
     */
    function checkPrice(
        Info storage _info,
        bool _isLong,
        uint128 _price
    ) internal returns (uint128 updatedPrice) {
        Info memory cache = Info(_info.askTime, _info.minAskPrice, _info.bitTime, _info.maxBitPrice);

        updatedPrice = getUpdatedPrice(cache, _isLong, _price, uint128(block.timestamp));

        _info.askTime = cache.askTime;
        _info.minAskPrice = cache.minAskPrice;
        _info.bitTime = cache.bitTime;
        _info.maxBitPrice = cache.maxBitPrice;
    }

    function getUpdatedPrice(
        Info memory _info,
        bool _isLong,
        uint128 _price,
        uint128 _timestamp
    ) internal pure returns (uint128 updatedPrice) {
        updatedPrice = _price;
        if (_isLong) {
            // if long
            if (_info.bitTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (updatedPrice < _info.maxBitPrice) {
                    uint128 tt = (_timestamp - _info.bitTime) / 1 minutes;
                    uint128 spreadClosing = SPREAD_DECREASE_PER_PERIOD * tt;
                    if (updatedPrice <= (_info.maxBitPrice * (1e4 - spreadClosing)) / 1e4) {
                        _info.maxBitPrice = (_info.maxBitPrice * (1e4 - spreadClosing)) / 1e4;
                    }
                    updatedPrice = _info.maxBitPrice;
                }
            }

            // Update min ask
            if (_info.minAskPrice > updatedPrice || _info.askTime + SPREAD_DECREASE_PER_PERIOD < _timestamp) {
                _info.minAskPrice = updatedPrice;
            }
            _info.askTime = _timestamp;
        } else {
            // if short
            if (_info.askTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (updatedPrice > _info.minAskPrice) {
                    uint128 tt = (_timestamp - _info.askTime) / 1 minutes;
                    uint128 spreadClosing = SPREAD_DECREASE_PER_PERIOD * tt;
                    if (updatedPrice <= (_info.minAskPrice * (1e4 + spreadClosing)) / 1e4) {
                        _info.minAskPrice = (_info.minAskPrice * (1e4 + spreadClosing)) / 1e4;
                    }
                    updatedPrice = _info.minAskPrice;
                }
            }

            // Update max bit
            if (_info.maxBitPrice < updatedPrice || _info.bitTime + SPREAD_DECREASE_PER_PERIOD < _timestamp) {
                _info.maxBitPrice = updatedPrice;
            }
            _info.bitTime = _timestamp;
        }
    }
}
