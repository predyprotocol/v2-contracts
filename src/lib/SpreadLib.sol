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

    /// @dev block period for ETH - USD
    uint256 private constant SAFETY_BLOCK_PERIOD = 1;

    /// @dev number of blocks per minute in arbitrum
    uint256 private constant NUM_BLOCKS_PER_MINUTE = 12;

    /// @dev 4 bps
    uint256 private constant SPREAD_DECREASE_PER_PERIOD = 4;

    /// @dev 80 bps
    int256 private constant MAX_SPREAD_DECREASE = 80;

    struct Info {
        uint128 blockLastLongTransaction;
        int128 minLongTradePrice;
        uint128 blockLastShortTransaction;
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
        int256 _price,
        uint256 _blocknumber
    ) internal returns (int256 adjustedPrice) {
        Info memory cache = Info(
            _info.blockLastLongTransaction,
            _info.minLongTradePrice,
            _info.blockLastShortTransaction,
            _info.maxShortTradePrice
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
            if (_info.blockLastShortTransaction >= _blocknumber - SAFETY_BLOCK_PERIOD) {
                // Within safety period
                if (adjustedPrice < _info.maxShortTradePrice) {
                    uint256 tt = (_blocknumber - _info.blockLastShortTransaction) / NUM_BLOCKS_PER_MINUTE;
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
            if (
                _info.minLongTradePrice > adjustedPrice ||
                _info.blockLastLongTransaction + SAFETY_BLOCK_PERIOD < _blocknumber
            ) {
                _info.minLongTradePrice = adjustedPrice.toInt128();
            }
            _info.blockLastLongTransaction = uint128(_blocknumber);
        } else {
            // if short
            if (_info.blockLastLongTransaction >= _blocknumber - SAFETY_BLOCK_PERIOD) {
                // Within safety period
                if (adjustedPrice > _info.minLongTradePrice) {
                    uint256 tt = (_blocknumber - _info.blockLastLongTransaction) / NUM_BLOCKS_PER_MINUTE;
                    int256 spreadClosing = int256(SPREAD_DECREASE_PER_PERIOD.mul(tt));
                    if (spreadClosing > MAX_SPREAD_DECREASE) {
                        spreadClosing = MAX_SPREAD_DECREASE;
                    }
                    if (adjustedPrice >= (_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4) {
                        _info.minLongTradePrice = ((_info.minLongTradePrice.mul(1e4 + spreadClosing)) / 1e4).toInt128();
                    }
                    adjustedPrice = _info.minLongTradePrice;
                }
            }

            // Update max bit
            if (
                _info.maxShortTradePrice < adjustedPrice ||
                _info.blockLastShortTransaction + SAFETY_BLOCK_PERIOD < _blocknumber
            ) {
                _info.maxShortTradePrice = adjustedPrice.toInt128();
            }
            _info.blockLastShortTransaction = uint128(_blocknumber);
        }
    }
}
