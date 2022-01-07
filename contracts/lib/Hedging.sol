//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./LiqMath.sol";

library Hedging {
    struct Info {
        int128 underlyingPosition;
        int128 usdcBuffer;
        PoolInfo[2] pools;
    }

    struct PoolInfo {
        int128 usdcPosition;
        int128 delta;
        int128 entry;
        int128 latestEntry;
        int128 latestEntrySize;
    }

    /**
     * @notice Adds new delta position to info structure
     */
    function addPosition(
        Info storage _info,
        uint256 _poolId,
        int128 _newDelta,
        int128 _requiredCollateral,
        uint128 _spot
    ) external {
        int128 dd = _newDelta - _info.pools[_poolId].delta;

        if (dd < 0) {
            addLong(_info.pools[_poolId], uint128(-dd), _spot);
        } else {
            addShort(_info.pools[_poolId], uint128(dd), _spot);
        }

        // _info.usdcBuffer += _requiredCollateral;
        _info.pools[_poolId].usdcPosition += _requiredCollateral;

        _info.pools[_poolId].delta = _newDelta;
    }

    function addLong(
        PoolInfo storage _hedgeState,
        uint128 _amount,
        uint128 _spot
    ) internal {
        _hedgeState.latestEntrySize += int128(_amount);
        _hedgeState.latestEntry += int128((_amount * _spot) / 1e8);
    }

    function addShort(
        PoolInfo storage _hedgeState,
        uint128 _amount,
        uint128 _spot
    ) internal {
        _hedgeState.latestEntrySize -= int128(_amount);
        _hedgeState.latestEntry -= int128((_amount * _spot) / 1e8);
    }

    function getHedgeNotional(PoolInfo storage _hedgeState, uint128 _spot) external view returns (int128) {
        int128 hedgeNotional = _hedgeState.usdcPosition +
            (-int128(_spot) * _hedgeState.delta) /
            1e8 -
            getEntry(_hedgeState, _spot);
        return hedgeNotional;
    }

    /**
     * @notice Recalculates latest entry price by spot price
     * and returns sum of the latest entry price and the past entry price.
     */
    function getEntry(PoolInfo storage _hedgeState, uint128 _spot) internal view returns (int128) {
        return (_hedgeState.latestEntrySize * int128(_spot)) / 1e8 + _hedgeState.entry;
    }

    /**
     * @notice Completes hedging procedure
     */
    function complete(
        Info storage _info,
        int128 _underlyingPositionDelta,
        uint128 _spot
    ) external {
        int128 netEntry;
        uint128 totalEntry;

        for (uint256 i = 0; i < 2; i++) {
            netEntry += _info.pools[i].latestEntry;
        }

        for (uint256 i = 0; i < 2; i++) {
            totalEntry += LiqMath.abs(_info.pools[i].latestEntry);
        }

        int128 totalLoss = netEntry - (int128(_spot) * _underlyingPositionDelta) / 1e8;

        for (uint256 i = 0; i < 2; i++) {
            int128 loss = (int128(LiqMath.abs(_info.pools[i].latestEntry)) * totalLoss) / int128(totalEntry);

            _info.pools[i].entry = _info.pools[i].entry + _info.pools[i].latestEntry - loss;
            _info.pools[i].latestEntry = 0;
            _info.pools[i].latestEntrySize = 0;
        }
    }
}
