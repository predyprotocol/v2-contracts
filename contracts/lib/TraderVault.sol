//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./LiqMath.sol";
import "hardhat/console.sol";

library TraderVault {
    int128 constant MIN_INT128 = 1 - 2**127;

    struct TraderPosition {
        int128[2] size;
        // entry price scaled by 1e16
        int128[2] entry;
        int128 usdcPosition;
    }

    /**
     * check Initial Margin
     * @param _depositOrWithdrawAmount deposit for positive and withdrawal for negative
     * Min Int128 represents for full withdrawal
     */
    function checkIM(
        TraderPosition storage traderPosition,
        int128 _depositOrWithdrawAmount,
        int128 _martPrice0,
        int128 _markPrice1
    ) external returns (int128 finalDepositOrWithdrawAmount) {
        int128 im = getInitialOrMaintenanceMargin(
            traderPosition,
            _martPrice0,
            _markPrice1,
            true
        );
        int128 derivativePnL = getPnL(traderPosition, _martPrice0, _markPrice1);
        int128 pnl = traderPosition.usdcPosition + derivativePnL;

        if (_depositOrWithdrawAmount <= -pnl && pnl >= 0) {
            finalDepositOrWithdrawAmount = im - pnl;
            traderPosition.usdcPosition = im - derivativePnL;
        } else {
            traderPosition.usdcPosition += _depositOrWithdrawAmount;

            finalDepositOrWithdrawAmount = _depositOrWithdrawAmount;
        }

        require(traderPosition.usdcPosition + derivativePnL >= im, "IM");
    }

    function getIM(
        TraderPosition memory _traderPosition,
        int128 _martPrice0,
        int128 _markPrice1
    ) external pure returns (int128) {
        int128 derivativePnL = getPnL(
            _traderPosition,
            _martPrice0,
            _markPrice1
        );
        int128 im = getInitialOrMaintenanceMargin(
            _traderPosition,
            _martPrice0,
            _markPrice1,
            true
        );
        return im - derivativePnL - _traderPosition.usdcPosition;
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
                getInitialOrMaintenanceMargin(
                    traderPosition,
                    _martPrice0,
                    _markPrice1,
                    false
                ),
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
                getInitialOrMaintenanceMargin(
                    traderPosition,
                    _martPrice0,
                    _markPrice1,
                    false
                ),
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
        int128 _martPrice0,
        int128 _markPrice1,
        bool _isImOrMm
    ) internal pure returns (int128) {
        uint128 im = ((LiqMath.abs(_traderPosition.size[0]) *
            uint128(_martPrice0) +
            LiqMath.abs(_traderPosition.size[1]) *
            uint128(_markPrice1)) * (_isImOrMm ? 20 : 8)) / (100 * 1e10);

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
