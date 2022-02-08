//SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ILPToken.sol";

contract LPToken is ERC20, ILPToken {
    address public perpetualMarket;

    /**
     * @notice liquidity provider token constructor
     */
    constructor() ERC20("Predy V2 LP Token", "PREDY-V2-LP") {
        perpetualMarket = msg.sender;

        // The decimals of LP token is 6
        _setupDecimals(6);
    }

    modifier onlyPerpetualMarket() {
        require(msg.sender == perpetualMarket, "Not PerpetualMarket");
        _;
    }

    /**
     * @notice set perpetual market address
     * @param _perpetualMarket perpetual market address
     */
    function setPerpetualMarket(address _perpetualMarket) external onlyPerpetualMarket {
        require(_perpetualMarket != address(0), "Zero Address");
        perpetualMarket = _perpetualMarket;
    }

    /**
     * @notice mint LPToken
     * @param _account account to mint to
     * @param _amount amount to mint
     */
    function mint(address _account, uint256 _amount) external override onlyPerpetualMarket {
        _mint(_account, _amount);
    }

    /**
     * @notice burn LPToken
     * @param _account account to burn from
     * @param _amount amount to burn
     */
    function burn(address _account, uint256 _amount) external override onlyPerpetualMarket {
        _burn(_account, _amount);
    }
}
