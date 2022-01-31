//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "../lib/EntryPriceMath.sol";

contract EntryPriceMathTester {
    function testUpdateEntryPrice(
        uint256 _entryPrice,
        int256 _position,
        uint256 _tradePrice,
        int256 _positionTrade
    ) external pure returns (uint256 newEntryPrice, int256 profit) {
        return EntryPriceMath.updateEntryPrice(_entryPrice, _position, _tradePrice, _positionTrade);
    }
}
