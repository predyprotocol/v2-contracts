// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/**
 * @notice Mock of Chainlink Aggregator contract
 */
contract MockChainlinkAggregator {
    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(uint80 => RoundData) public getRoundData;
    RoundData public latestRoundData;

    function setLatestRoundData(uint80 roundId, int256 answer) external {
        RoundData storage roundData = getRoundData[roundId];
        roundData.roundId = roundId;
        roundData.answer = answer;
        roundData.startedAt = block.timestamp;
        roundData.updatedAt = block.timestamp;

        latestRoundData = roundData;
    }
}
