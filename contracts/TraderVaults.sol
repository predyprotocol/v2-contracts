//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPerpetualMarketCore.sol";
import "./lib/TraderVault.sol";

/**
 * @title TraderVaults
 */
contract TraderVaults {
    mapping(address => mapping(uint256 => TraderVault.TraderPosition)) private traders;

    address private perpetualMarket;

    IPerpetualMarketCore private perpetualMarketCore;

    modifier onlyPerpetualMarket() {
        require(msg.sender == perpetualMarket);
        _;
    }

    /**
     * @notice initialize trader vault
     */
    constructor(address _perpetualMarketCore) {
        perpetualMarket = msg.sender;
        perpetualMarketCore = IPerpetualMarketCore(_perpetualMarketCore);
    }

    function setPerpetualMarket(address _perpetualMarket) external onlyPerpetualMarket {
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice make long or short positions
     */
    function addPositionDirectly(
        address _trader,
        uint256 _vaultId,
        uint256 _poolId,
        int128 _size,
        int128 _entry
    ) public onlyPerpetualMarket {
        TraderVault.TraderPosition storage traderPosition = traders[_trader][_vaultId];

        traderPosition.size[_poolId] += _size;
        traderPosition.entry[_poolId] += _entry;
    }

    /**
     * checm Initial Margin
     * @param _depositOrWithdrawAmount deposit for positive and withdrawal for negative
     * Min Int128 represents for full withdrawal
     */
    function updateUsdcPositionAndCheckInitialMargin(
        address _trader,
        uint256 _vaultId,
        int128 _depositOrWithdrawAmount
    ) public onlyPerpetualMarket returns (int128 finalDepositOrWithdrawAmount) {
        TraderVault.TraderPosition storage traderPosition = traders[_trader][_vaultId];

        (uint128 spot, ) = perpetualMarketCore.getUnderlyingPrice();

        return
            TraderVault.updateUsdcPositionAndCheckInitialMargin(
                traderPosition,
                _depositOrWithdrawAmount,
                int128(perpetualMarketCore.getMarkPrice(0, spot)),
                int128(perpetualMarketCore.getMarkPrice(1, spot))
            );
    }

    /**
     * @notice liquidate short positions in a vault.
     */
    function liquidate(
        address _trader,
        uint256 _vaultId,
        uint256 _poolId,
        int128 _size
    ) external onlyPerpetualMarket returns (uint128) {
        TraderVault.TraderPosition storage traderPosition = traders[_trader][_vaultId];

        (uint128 spot, ) = perpetualMarketCore.getUnderlyingPrice();

        return
            TraderVault.liquidate(
                traderPosition,
                _poolId,
                _size,
                spot,
                int128(perpetualMarketCore.getMarkPrice(0, spot)),
                int128(perpetualMarketCore.getMarkPrice(1, spot))
            );
    }

    ////////////////////////
    //  Getter Functions  //
    ////////////////////////

    function getVault(address _trader, uint256 _vaultId)
        external
        view
        returns (TraderVault.TraderPosition memory traderPosition)
    {
        traderPosition = traders[_trader][_vaultId];
    }
}
