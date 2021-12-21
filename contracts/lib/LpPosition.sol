//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./LiqMath.sol";
import "hardhat/console.sol";

/**
 * @title LpPosition
 * @notice Functions to manage positions of Liquidity Provider
 */
library LpPosition {
    struct Info {
        // Total liquidity of a position
        uint128 liquidity;
        // The latest snapshot of the realized profit and loss
        int128 realizedPnLInsideLast;
        // Realized profit and loss
        int128 realizedPnL;
    }

    /**
     * @notice Returns a info struct of a LP position
     */
    function get(
        mapping(bytes32 => Info) storage self,
        address _owner,
        int24 _lower,
        int24 _upper
    ) internal view returns (LpPosition.Info storage position) {
        position = self[keccak256(abi.encodePacked(_owner, _lower, _upper))];
    }

    /**
     * @notice Update a position
     * @param _position The position to update
     * @param _liquidityDelta The change in pool liquidity by the position update
     * @param _realizedPnLInside Realized profit and loss inside the range of the position
     */
    function update(
        Info storage _position,
        int128 _liquidityDelta,
        int128 _realizedPnLInside
    ) internal {
        int128 realizedPnL = ((_realizedPnLInside -
            _position.realizedPnLInsideLast) * int128(_position.liquidity)) /
            1e6;

        _position.liquidity = LiqMath.addDelta(
            _position.liquidity,
            _liquidityDelta
        );
        _position.realizedPnL += realizedPnL;
        _position.realizedPnLInsideLast = _realizedPnLInside;
    }
}
