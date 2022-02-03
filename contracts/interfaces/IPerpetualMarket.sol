//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/TraderVaultLib.sol";

interface IPerpetualMarket {
    struct MultiTradeParams {
        uint256 vaultId;
        uint256 subVaultIndex;
        int128[2] tradeAmounts;
        int128 collateralRatio;
        uint256[2] limitPrices;
        uint256 deadline;
    }

    struct SingleTradeParams {
        uint256 productId;
        uint256 vaultId;
        uint256 subVaultIndex;
        uint128 tradeAmount;
        int128 collateralRatio;
        uint256 limitPrice;
        uint256 deadline;
    }

    struct VaultStatus {
        int256 positionValue;
        int256 minCollateral;
        int256[2][] positionValues;
        int256[2][] fundingPaid;
        TraderVaultLib.TraderVault rawVaultData;
    }

    struct TradeInfo {
        int256 tradePrice;
        int256 indexPrice;
        int256 fundingRate;
        int256 tradeFee;
        int256 protocolFee;
        int256 fundingFee;
        uint256 totalValue;
        uint256 totalFee;
    }

    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external;

    function deposit(uint128 _depositAmount) external;

    function withdraw(uint128 _withdrawnAmount) external;

    function openPositions(MultiTradeParams memory _tradeParams) external;

    function openLongPosition(SingleTradeParams memory _tradeParams) external;

    function openShortPosition(SingleTradeParams memory _tradeParams) external;

    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external;

    function getTokenAmountForHedging()
        external
        view
        returns (
            bool,
            uint256,
            uint256
        );

    function execHedge() external returns (uint256 amountUsdc, uint256 amountUnderlying);

    function getLPTokenPrice(int256 _deltaLiquidityAmount) external view returns (uint256);

    function getTradePrice(uint256 _productId, int128 _tradeAmount)
        external
        view
        returns (TradeInfo memory tradePriceInfo);

    function getMinCollateral(
        address _vaultOwner,
        uint256 _vaultId,
        int128[2] memory tradeAmounts,
        uint256 _spotPrice
    ) external view returns (int256);

    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view returns (VaultStatus memory);
}
