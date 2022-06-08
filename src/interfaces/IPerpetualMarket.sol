// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/TraderVaultLib.sol";

interface IPerpetualMarket {
    struct MultiTradeParams {
        uint256 vaultId;
        TradeParams[] trades;
        int256 marginAmount;
        uint256 deadline;
    }

    struct TradeParams {
        uint256 productId;
        uint256 subVaultIndex;
        int128 tradeAmount;
        uint256 limitPrice;
        bytes metadata;
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

    function initialize(uint256 _depositAmount, int256 _initialFundingRate) external;

    function deposit(uint256 _depositAmount) external;

    function withdraw(uint128 _withdrawnAmount) external;

    function trade(MultiTradeParams memory _tradeParams) external;

    function addMargin(uint256 _vaultId, int256 _marginToAdd) external;

    function liquidateByPool(uint256 _vaultId) external;

    function getTokenAmountForHedging()
        external
        view
        returns (
            bool,
            uint256,
            uint256
        );

    function execHedge(bool _withRebalance) external returns (uint256 amountUsdc, uint256 amountUnderlying);

    function getLPTokenPrice(int256 _deltaLiquidityAmount) external view returns (uint256);

    function getTradePrice(uint256 _productId, int256[2] memory _tradeAmounts)
        external
        view
        returns (TradeInfo memory tradePriceInfo);

    function getMinCollateralToAddPosition(uint256 _vaultId, int128[2] memory _tradeAmounts)
        external
        view
        returns (int256 minCollateral);

    function getTraderVault(uint256 _vaultId) external view returns (TraderVaultLib.TraderVault memory);

    function getVaultStatus(uint256 _vaultId) external view returns (VaultStatus memory);
}
