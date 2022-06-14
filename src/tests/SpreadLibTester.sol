//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/SpreadLib.sol";

/**
 * @title SpreadLibTester
 * @notice Tester contract for Spread library
 */
contract SpreadLibTester {
    SpreadLib.Info public info;

    function init() external {
        SpreadLib.init(info);
    }

    function setParams(uint256 _safetyBlockPeriod, uint256 _numBlocksPerSpreadDecreasing) external {
        SpreadLib.setParams(info, _safetyBlockPeriod, _numBlocksPerSpreadDecreasing);
    }

    function getUpdatedPrice(
        SpreadLib.Info memory _info,
        bool _isLong,
        int256 _price,
        uint128 _timestamp
    ) external pure returns (int256 updatedPrice) {
        return SpreadLib.getUpdatedPrice(_info, _isLong, _price, _timestamp);
    }

    function updatePrice(
        bool _isLong,
        int256 _price,
        uint128 _timestamp
    ) external returns (int256 updatedPrice) {
        SpreadLib.Info memory cache = SpreadLib.Info(
            info.blockLastLongTransaction,
            info.minLongTradePrice,
            info.blockLastShortTransaction,
            info.maxShortTradePrice,
            info.safetyBlockPeriod,
            info.numBlocksPerSpreadDecreasing
        );

        updatedPrice = SpreadLib.getUpdatedPrice(cache, _isLong, _price, _timestamp);

        info.blockLastLongTransaction = cache.blockLastLongTransaction;
        info.minLongTradePrice = cache.minLongTradePrice;
        info.blockLastShortTransaction = cache.blockLastShortTransaction;
        info.maxShortTradePrice = cache.maxShortTradePrice;
    }
}
