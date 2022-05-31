//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "forge-std/Test.sol";

import "../../src/lib/EntryPriceMath.sol";

contract EntryPriceMathTest is Test {
    function testUpdateEntryPrice(
        int256 _entryPrice,
        int256 _position,
        int256 _tradePrice,
        int256 _positionTrade
    ) external pure returns (int256 newEntryPrice, int256 profit) {
        return EntryPriceMath.updateEntryPrice(_entryPrice, _position, _tradePrice, _positionTrade);
    }
}
