// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

/**
 * @notice Mock of Chainlink Aggregator contract
 */
contract MockArbSys {
    uint256 _blocknumber;

    function arbBlockNumber() external view returns (uint256) {
        return _blocknumber;
    }

    function setBlockNumber(uint256 blocknumber) external {
        _blocknumber = blocknumber;
    }
}
