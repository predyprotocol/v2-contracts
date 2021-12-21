//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IFeeLevel {
    struct Info {
        uint128 liquidityGross;
        // the amount of net liquidity added or subtracted when tick crosses.
        int128 liquidityNet;
        // realized PnL per liquidity on the other side of the current fee level
        int128 realizedPnLOutside;
    }
}
