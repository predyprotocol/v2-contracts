//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./LiqMath.sol";
import "hardhat/console.sol";

library TraderVault {
    struct TraderPosition {
        int128[2] size;
        // entry price scaled by 1e16
        int128[2] entry;
        int128 usdcPosition;
    }

    /**
     * checm Initial Margin
     * @param _depositOrWithdrawAmount deposit for positive and withdrawal for negative
     * Min Int128 represents for full withdrawal
     */
    function checkIM(
        TraderPosition storage traderPosition,
        int128 _depositOrWithdrawAmount,
        uint128 _spot,
        int128 _martPrice0,
        int128 _markPrice1
    ) external returns (int128 finalDepositOrWithdrawAmount) {
        int128 im = getInitialOrMaintenanceMargin(traderPosition, _spot, true);
        int128 derivativePnL = getPnL(traderPosition, _martPrice0, _markPrice1);
        int128 pnl = traderPosition.usdcPosition + derivativePnL;

        if (_depositOrWithdrawAmount <= -pnl && pnl > 0) {
            finalDepositOrWithdrawAmount = -pnl;
            traderPosition.usdcPosition = -derivativePnL;
        } else {
            traderPosition.usdcPosition += _depositOrWithdrawAmount;

            finalDepositOrWithdrawAmount = _depositOrWithdrawAmount;
        }

        require(traderPosition.usdcPosition + derivativePnL >= im, "IM");
    }

    function deposit(
        TraderPosition storage _traderPosition,
        int128 _depositAmount
    ) external {
        require(_depositAmount > 0);
        _traderPosition.usdcPosition += _depositAmount;
    }

    /**
     * @notice liquidate short positions in a vault.
     */
    function liquidate(
        TraderPosition storage traderPosition,
        uint256 _poolId,
        int128 _size,
        uint128 _spot,
        int128 _martPrice0,
        int128 _markPrice1
    ) external returns (uint128) {
        require(
            traderPosition.usdcPosition +
                getPnL(traderPosition, _martPrice0, _markPrice1) <
                getInitialOrMaintenanceMargin(traderPosition, _spot, false),
            "LB"
        );

        require(
            LiqMath.abs(traderPosition.size[_poolId]) >= LiqMath.abs(_size),
            "LS"
        );

        traderPosition.size[_poolId] -= _size;

        require(
            traderPosition.usdcPosition +
                getPnL(traderPosition, _martPrice0, _markPrice1) >=
                getInitialOrMaintenanceMargin(traderPosition, _spot, false),
            "LA"
        );

        uint128 reward = 100 * 1e6 + (LiqMath.abs(_size) * _spot) / 1e10;

        require(
            int128(reward) >
                getPnL(traderPosition, _martPrice0, _markPrice1) +
                    traderPosition.usdcPosition,
            "LR"
        );

        return reward;
    }

    /**
     * @return required margin scaled by 1e6
     */
    function getInitialOrMaintenanceMargin(
        TraderPosition memory _traderPosition,
        uint128 _spot,
        bool _isImOrMm
    ) internal pure returns (int128) {
        uint128 im = ((LiqMath.abs(_traderPosition.size[0]) +
            LiqMath.abs(_traderPosition.size[1])) *
            _spot *
            (_isImOrMm ? 20 : 8)) / (100 * 1e10);

        return int128(im);
    }

    /**
     * @return Profit and Loss scaled by 1e6
     */
    function getPnL(
        TraderPosition memory _traderPosition,
        int128 _martPrice0,
        int128 _markPrice1
    ) internal pure returns (int128) {
        int128 pnl = (_martPrice0 *
            _traderPosition.size[0] -
            _traderPosition.entry[0] +
            _markPrice1 *
            _traderPosition.size[1] -
            _traderPosition.entry[1]);

        return pnl / 1e10;
    }
}
