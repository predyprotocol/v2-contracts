//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../PerpetualMarketCore.sol";

/**
 * @title PerpetualMarketCoreTester
 * @notice Tester contract for Perpetual Market Core
 */
contract PerpetualMarketCoreTester is PerpetualMarketCore {
    constructor(address _priceFeedAddress) PerpetualMarketCore(_priceFeedAddress) {}

    function testCalculateUnlockedLiquidity(
        uint256 _amountLiquidity,
        uint256 _amountLockedLiquidity,
        uint256 _deltaM,
        int256 _hedgePositionValue
    ) external pure returns (uint128 newLockedLiquidity, uint128 newAmountLiquidity) {
        return calculateUnlockedLiquidity(_amountLiquidity, _amountLockedLiquidity, _deltaM, _hedgePositionValue);
    }
}
