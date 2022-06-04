// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

/**
 * @notice Mock of Chainlink Aggregator contract
 */
contract MockArbSys {

    uint _blocknumber;

    function arbBlockNumber() external view returns (uint) {
      return _blocknumber;
    }

    function setBlockNumber(uint blocknumber) external {
        _blocknumber = blocknumber;
    }
}
