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
     */
    function update(Info storage _position, int128 _liquidityDelta) internal {
        _position.liquidity = LiqMath.addDelta(_position.liquidity, _liquidityDelta);
    }
}
