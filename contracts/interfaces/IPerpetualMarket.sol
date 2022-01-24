//SPDX-License-Identifier: Unlicense
pragma solidity =0.7.6;
pragma abicoder v2;

import "../lib/TraderVaultLib.sol";

interface IPerpetualMarket {
    struct TradeParams {
        uint256 vaultId;
        int128[2] tradeAmounts;
        int128 collateralRatio;
    }

    struct VaultStatus {
        int128 positionValue;
        int128 minCollateral;
        TraderVaultLib.TraderVault position;
    }

    function initialize(uint128 _depositAmount, int128 _initialFundingRate) external;

    function deposit(uint128 _depositAmount) external;

    function withdraw(uint128 _withdrawnAmount) external;

    function openPositions(TradeParams memory _tradeParams) external;

    function openLongPosition(
        uint256 _productId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external;

    function openShortPosition(
        uint256 _productId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external;

    function liquidateByPool(address _vaultOwner, uint256 _vaultId) external;

    function execHedge() external;

    function getLPTokenPrice() external view returns (uint256);

    function getTradePrice(uint256 _productId, int128 _size) external view returns (int128);

    function getVaultStatus(address _vaultOwner, uint256 _vaultId) external view returns (VaultStatus memory);
}
