//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/TraderVaultLib.sol";

interface IPerpetualMarket {
    struct MultiTradeParams {
        uint256 vaultId;
        int128[2] tradeAmounts;
        int128 collateralRatio;
        uint256[2] limitPrices;
        uint256 deadline;
    }

    struct SingleTradeParams {
        uint256 productId;
        uint256 vaultId;
        uint128 tradeAmount;
        int128 collateralRatio;
        uint256 limitPrice;
        uint256 deadline;
    }

    struct VaultStatus {
        int256 positionValue;
        int256 minCollateral;
        int256[2] perpetualValues;
        int256[2] fundingPaid;
        TraderVaultLib.TraderVault position;
    }

    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external;

    function deposit(uint128 _depositAmount) external;

    function withdraw(uint128 _withdrawnAmount) external;

    function openPositions(MultiTradeParams memory _tradeParams) external;

    function openLongPosition(SingleTradeParams memory _tradeParams) external;

    function openShortPosition(SingleTradeParams memory _tradeParams) external;

    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external;

    function execHedge() external;

    function getLPTokenPrice() external view returns (uint256);

    function getTradePrice(uint256 _productId, int128 _size) external view returns (int256);

    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view returns (VaultStatus memory);
}
