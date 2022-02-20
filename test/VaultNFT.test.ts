import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { before } from 'mocha'
import { VaultNFT } from '../typechain'

describe('VaultNFT', function () {
  let wallet: Wallet, other: Wallet
  let vaultNFT: VaultNFT

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
  })

  beforeEach(async () => {
    const VaultNFT = await ethers.getContractFactory('VaultNFT')
    vaultNFT = (await VaultNFT.deploy('', '', '')) as VaultNFT
  })

  describe('init', () => {
    it('set perpetual market', async () => {
      await vaultNFT.init(other.address)
    })

    it('reverts if not deployer', async () => {
      await expect(vaultNFT.connect(other).init(other.address)).to.be.revertedWith('Caller is not deployer')
    })

    it('reverts if address is 0', async () => {
      await expect(vaultNFT.init(ethers.constants.AddressZero)).to.be.revertedWith('Zero address')
    })
  })

  describe('mintNFT', () => {
    beforeEach(async () => {
      await vaultNFT.init(wallet.address)
    })

    it('mint NFT', async () => {
      await vaultNFT.mintNFT(wallet.address)

      expect(await vaultNFT.balanceOf(wallet.address)).to.be.eq(1)
    })

    it('reverts if not Perpetual Market', async () => {
      await expect(vaultNFT.connect(other).mintNFT(wallet.address)).to.be.revertedWith('Not Perpetual Market')
    })
  })
})
