//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IPerpetualMarketCore {
    function getUnderlyingPrice() external view returns (uint128, uint256);

    function getMarkPrice(uint256 _poolId, uint128 _spot) external view returns (uint128);
}
