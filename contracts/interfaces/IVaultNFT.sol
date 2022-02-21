// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IVaultNFT is IERC721 {
    function mintNFT(address _recipient) external returns (uint256 tokenId);
}
