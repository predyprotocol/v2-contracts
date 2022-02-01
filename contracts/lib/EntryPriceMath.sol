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

    /**
     * @notice Calculates new entry price and return profit if position is closed
     *
     * Calculation Patterns
     *  |Position|PositionTrade|NewPosition|Pattern|
     *  |       +|            +|          +|      A|
     *  |       +|            -|          +|      B|
     *  |       +|            -|          -|      C|
     *  |       -|            -|          -|      A|
     *  |       -|            +|          -|      B|
     *  |       -|            +|          +|      C|
     *
     * Calculations
     *  Pattern A (open positions)
     *   NewEntryPrice = (EntryPrice * |Position| + TradePrce * |PositionTrade|) / (Position + PositionTrade)
     *
     *  Pattern B (close positions)
     *   NewEntryPrice = EntryPrice
     *   ProfitValue = -PositionTrade * (TradePrice - EntryPrice)
     *
     *  Pattern C (close all positions & open new)
     *   NewEntryPrice = TradePrice
     *   ProfitValue = Position * (TradePrice - EntryPrice)
     *
     * @param _entryPrice previous entry price
     * @param _position current position
     * @param _tradePrice trade price
     * @param _positionTrade position to trade
     * @return newEntryPrice new entry price
     * @return profitValue notional profit value when positions are closed
     */
    function updateEntryPrice(
        uint256 _entryPrice,
        int256 _position,
        uint256 _tradePrice,
        int256 _positionTrade
    ) internal pure returns (uint256 newEntryPrice, int256 profitValue) {
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
            profitValue = (-_positionTrade).mul(_tradePrice.toInt256().sub(_entryPrice.toInt256())) / 1e8;
        } else {
            newEntryPrice = _tradePrice;

            profitValue = _position.mul(_tradePrice.toInt256().sub(_entryPrice.toInt256())) / 1e8;
        }
    }
}
