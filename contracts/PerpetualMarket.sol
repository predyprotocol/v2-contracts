//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./PerpetualMarketCore.sol";

/**
 * @title Perpetual Market
 * @notice Perpetual Market Contract
 */
contract PerpetualMarket is ERC721 {
    PerpetualMarketCore private immutable perpetualMarketCore;
    ILiquidityPool private immutable liquidityPool;

    struct TradeParams {
        uint256 vaultId;
        int128[2] sizes;
        int128 depositOrWithdrawAmount;
    }

    struct DepositParams {
        bool closeSoon;
        uint256 vaultId;
    }

    struct Position {
        uint256 poolId;
        int24 feeLevelLower;
        int24 feeLevelUpper;
    }

    event Deposited(
        uint256 poolId,
        uint256 tokenId,
        uint128 issued,
        uint128 amount
    );

    uint256 private nextId = 1;

    int128 private constant MIN_INT128 = 1 - 2**127;

    mapping(uint256 => Position) public positions;

    /**
     * @notice initialize Perpetual Market
     */
    constructor(
        PerpetualMarketCore _perpetualMarketCore,
        ILiquidityPool _liquidityPool
    ) ERC721("Predy V2 Position", "PREDY-V2-POS") {
        perpetualMarketCore = _perpetualMarketCore;
        liquidityPool = _liquidityPool;
    }

    /**
     * @notice provide liquidity to the range of fee levels
     */
    function deposit(
        uint256 _poolId,
        uint128 _amount,
        int24 _feeLevelLower,
        int24 _feeLevelUpper,
        DepositParams memory _depositParams
    ) external {
        require(_amount > 0);
        checkFeeLevels(_feeLevelLower, _feeLevelUpper);
        PerpetualMarketCore.PositionChangeResult
            memory result = perpetualMarketCore.deposit(
                _poolId,
                _amount,
                _feeLevelLower,
                _feeLevelUpper
            );

        int128 collateralAmount;

        collateralAmount = int128(result.depositAmount);

        if (result.size > 0) {
            perpetualMarketCore.addPositionDirectly(
                msg.sender,
                _depositParams.vaultId,
                _poolId,
                int128(result.size),
                result.entryPrice
            );

            if (_depositParams.closeSoon) {
                uint128 totalPrice0 = perpetualMarketCore.addOrRemovePositions(
                    _poolId,
                    -int128(result.size)
                );

                perpetualMarketCore.addPositionDirectly(
                    msg.sender,
                    _depositParams.vaultId,
                    _poolId,
                    -int128(result.size),
                    -int128(totalPrice0)
                );
            }

            int128 im = getIM(msg.sender, _depositParams.vaultId);

            collateralAmount += perpetualMarketCore.checkIM(
                msg.sender,
                _depositParams.vaultId,
                im
            );

            if (_depositParams.closeSoon) {
                collateralAmount += perpetualMarketCore.checkIM(
                    msg.sender,
                    _depositParams.vaultId,
                    MIN_INT128
                );
            }
        }

        // Receive collateral from msg.sender
        if (collateralAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint128(collateralAmount)
            );
        } else {
            liquidityPool.sendLiquidity(msg.sender, uint128(-collateralAmount));
        }

        uint256 tokenId;

        _mint(msg.sender, tokenId = nextId++);

        positions[tokenId] = Position(_poolId, _feeLevelLower, _feeLevelUpper);

        emit Deposited(_poolId, tokenId, _amount, result.depositAmount);
    }

    /**
     * @notice withdraw liquidity from the range of fee levels
     */
    function withdraw(
        uint256 _tokenId,
        uint128 _amount,
        DepositParams memory _depositParams
    ) external {
        require(_amount > 0);
        require(msg.sender == ownerOf(_tokenId), "TID");
        Position memory position = positions[_tokenId];

        checkFeeLevels(position.feeLevelLower, position.feeLevelUpper);
        PerpetualMarketCore.PositionChangeResult
            memory result = perpetualMarketCore.withdraw(
                position.poolId,
                _amount,
                position.feeLevelLower,
                position.feeLevelUpper
            );

        int128 collateralAmount;

        collateralAmount = -int128(result.depositAmount);

        if (result.size > 0) {
            perpetualMarketCore.addPositionDirectly(
                msg.sender,
                _depositParams.vaultId,
                position.poolId,
                -int128(result.size),
                result.entryPrice
            );

            if (_depositParams.closeSoon) {
                uint128 totalPrice0 = perpetualMarketCore.addOrRemovePositions(
                    position.poolId,
                    int128(result.size)
                );

                perpetualMarketCore.addPositionDirectly(
                    msg.sender,
                    _depositParams.vaultId,
                    position.poolId,
                    int128(result.size),
                    int128(totalPrice0)
                );
            }

            int128 im = getIM(msg.sender, _depositParams.vaultId);

            collateralAmount += perpetualMarketCore.checkIM(
                msg.sender,
                _depositParams.vaultId,
                im
            );

            if (_depositParams.closeSoon) {
                collateralAmount += perpetualMarketCore.checkIM(
                    msg.sender,
                    _depositParams.vaultId,
                    MIN_INT128
                );
            }
        }

        // Send collateral to msg.sender
        liquidityPool.sendLiquidity(msg.sender, uint128(-collateralAmount));
    }

    /**
     * @notice Open new position of the perpetual contract
     */
    function openPositions(TradeParams memory _tradeParams) public {
        uint128 totalPrice0;
        uint128 totalPrice1;

        if (_tradeParams.sizes[0] != 0) {
            totalPrice0 = perpetualMarketCore.addOrRemovePositions(
                0,
                _tradeParams.sizes[0]
            );

            perpetualMarketCore.addPositionDirectly(
                msg.sender,
                _tradeParams.vaultId,
                0,
                _tradeParams.sizes[0],
                _tradeParams.sizes[0] > 0
                    ? int128(totalPrice0)
                    : -int128(totalPrice0)
            );
        }

        if (_tradeParams.sizes[1] != 0) {
            totalPrice1 = perpetualMarketCore.addOrRemovePositions(
                1,
                _tradeParams.sizes[1]
            );

            perpetualMarketCore.addPositionDirectly(
                msg.sender,
                _tradeParams.vaultId,
                1,
                _tradeParams.sizes[1],
                _tradeParams.sizes[1] > 0
                    ? int128(totalPrice1)
                    : -int128(totalPrice1)
            );
        }

        int128 finalDepositOrWithdrawAmount = perpetualMarketCore.checkIM(
            msg.sender,
            _tradeParams.vaultId,
            _tradeParams.depositOrWithdrawAmount
        );

        if (finalDepositOrWithdrawAmount > 0) {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uint128(finalDepositOrWithdrawAmount)
            );
        } else {
            liquidityPool.sendLiquidity(
                msg.sender,
                uint128(-finalDepositOrWithdrawAmount)
            );
        }
    }

    /**
     * @notice Open new long position of the perpetual contract
     */
    function openLongPosition(
        uint256 _poolId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external {
        int128[2] memory sizes;

        sizes[_poolId] = int128(_size);

        openPositions(TradeParams(_vaultId, sizes, _depositOrWithdrawAmount));
    }

    /**
     * @notice Open new short position of the perpetual contract
     */
    function openShortPosition(
        uint256 _poolId,
        uint256 _vaultId,
        uint128 _size,
        int128 _depositOrWithdrawAmount
    ) external {
        int128[2] memory sizes;

        sizes[_poolId] = -int128(_size);

        openPositions(TradeParams(_vaultId, sizes, _depositOrWithdrawAmount));
    }

    /**
     * @notice Liquidate a vault by Pool
     */
    function liquidateByPool(
        uint256 _poolId,
        uint256 _vaultId,
        int128 _size
    ) external {
        uint128 reward = perpetualMarketCore.liquidate(
            msg.sender,
            _vaultId,
            _poolId,
            _size
        );

        perpetualMarketCore.addOrRemovePositions(_poolId, _size);

        liquidityPool.sendLiquidity(msg.sender, reward);
    }

    /**
     * @notice execute hedging
     */
    function execHedge() external {
        (uint256 usdcAmount, uint256 uAmount, bool isLong) = perpetualMarketCore
            .execHedge();

        if (isLong) {
            ERC20(liquidityPool.underlying()).transferFrom(
                msg.sender,
                address(liquidityPool),
                uAmount
            );
            liquidityPool.sendLiquidity(msg.sender, usdcAmount);
        } else {
            ERC20(liquidityPool.collateral()).transferFrom(
                msg.sender,
                address(liquidityPool),
                usdcAmount
            );
            liquidityPool.sendUndrlying(msg.sender, uAmount);
        }
    }

    function checkFeeLevels(int24 _levelLower, int24 _levelUpper)
        internal
        pure
    {
        require(_levelLower < _levelUpper, "FLU");
        require(_levelLower >= 0, "FLM");
        require(_levelUpper <= 300, "FUM");
    }

    function getIM(address _trader, uint256 _vaultId)
        internal
        view
        returns (int128)
    {
        TraderVault.TraderPosition memory traderPosition = perpetualMarketCore
            .getVault(_trader, _vaultId);

        (uint128 spot, ) = perpetualMarketCore.getUnderlyingPrice();

        return
            TraderVault.getIM(
                traderPosition,
                int128(perpetualMarketCore.getMarkPrice(0, spot)),
                int128(perpetualMarketCore.getMarkPrice(1, spot))
            );
    }
}
