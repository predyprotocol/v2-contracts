//SPDX-License-Identifier: Unlicense
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
    /// @dev 8 bps
    uint256 private constant SPREAD_DECREASE_PER_PERIOD = 8;
    /// @dev 80 bps
    int256 private constant MAX_SPREAD_DECREASE = 80;

    struct Info {
        uint128 askTime;
        int128 minAskPrice;
        uint128 bitTime;
        int128 maxBitPrice;
    }

    function init(Info storage _info) internal {
        _info.minAskPrice = type(int128).max;
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
        int256 _price
    ) internal returns (int256 adjustedPrice) {
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
        int256 _price,
        uint256 _timestamp
    ) internal pure returns (int256 adjustedPrice) {
        adjustedPrice = _price;
        if (_isLong) {
            // if long
            if (_info.bitTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice < _info.maxBitPrice) {
                    uint256 tt = (_timestamp - _info.bitTime) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD.mul(tt));
                    if (spreadClosing > MAX_SPREAD_DECREASE) {
                        spreadClosing = MAX_SPREAD_DECREASE;
                    }
                    if (adjustedPrice <= (_info.maxBitPrice.mul(1e4 - spreadClosing)) / 1e4) {
                        _info.maxBitPrice = ((_info.maxBitPrice.mul(1e4 - spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.maxBitPrice;
                }
            }

            // Update min ask
            if (_info.minAskPrice > adjustedPrice || _info.askTime + SAFETY_PERIOD < _timestamp) {
                _info.minAskPrice = adjustedPrice.toInt128();
            }
            _info.askTime = uint128(_timestamp);
        } else {
            // if short
            if (_info.askTime >= _timestamp - SAFETY_PERIOD) {
                // Within safety period
                if (adjustedPrice > _info.minAskPrice) {
                    uint256 tt = (_timestamp - _info.askTime) / 1 minutes;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD.mul(tt));
                    if (spreadClosing > MAX_SPREAD_DECREASE) {
                        spreadClosing = MAX_SPREAD_DECREASE;
                    }
                    if (adjustedPrice <= (_info.minAskPrice.mul(1e4 + spreadClosing)) / 1e4) {
                        _info.minAskPrice = ((_info.minAskPrice.mul(1e4 + spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.minAskPrice;
                }
            }

            // Update max bit
            if (_info.maxBitPrice < adjustedPrice || _info.bitTime + SAFETY_PERIOD < _timestamp) {
                _info.maxBitPrice = adjustedPrice.toInt128();
            }
            _info.bitTime = uint128(_timestamp);
        }
    }
}
