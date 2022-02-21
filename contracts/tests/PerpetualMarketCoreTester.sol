//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../PerpetualMarketCore.sol";

/**
 * @title PerpetualMarketCoreTester
 * @notice Tester contract for Perpetual Market Core
 */
contract PerpetualMarketCoreTester is PerpetualMarketCore {
    constructor(address _priceFeedAddress) PerpetualMarketCore(_priceFeedAddress, "TestLPToken", "TestLPToken") {}

    function testCalculateUnlockedLiquidity(
        uint256 _amountLockedLiquidity,
        int256 _deltaM,
        int256 _hedgePositionValue
    ) external pure returns (int256 deltaLiquidity, int256 unlockLiquidityAmount) {
        return calculateUnlockedLiquidity(_amountLockedLiquidity, _deltaM, _hedgePositionValue);
    }
}
