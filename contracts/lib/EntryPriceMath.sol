//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "./Math.sol";

library EntryPriceMath {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    function updateEntryPrice(
        uint256 _entryPrice,
        int256 _position,
        uint256 _tradePrice,
        int256 _positionTrade
    ) internal pure returns (uint256 newEntryPrice, int256 profit) {
        int256 newPosition = _position.add(_positionTrade);
        if (_position == 0 || (_position > 0 && _positionTrade > 0) || (_position < 0 && _positionTrade < 0)) {
            newEntryPrice = (_entryPrice.mul(Math.abs(_position)).add(_tradePrice.mul(Math.abs(_positionTrade)))).div(
                Math.abs(_position.add(_positionTrade))
            );
        } else if (
            (_position > 0 && _positionTrade < 0 && newPosition > 0) ||
            (_position < 0 && _positionTrade > 0 && newPosition < 0)
        ) {
            newEntryPrice = _entryPrice;
            profit = Math.abs(_positionTrade).toInt256().mul(_tradePrice.toInt256().sub(_entryPrice.toInt256()));
        } else {
            newEntryPrice = _tradePrice;

            profit = Math.abs(_position).toInt256().mul(_tradePrice.toInt256().sub(_entryPrice.toInt256()));
        }
    }
}
