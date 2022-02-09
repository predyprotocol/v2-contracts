import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { before } from 'mocha'
import { LPToken } from '../typechain'

describe('LPToken', function () {
  let wallet: Wallet, other: Wallet
  let lpToken: LPToken

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
  })

  beforeEach(async () => {
    const LPToken = await ethers.getContractFactory('LPToken')

    lpToken = (await LPToken.deploy()) as LPToken
  })

  describe('setPerpetualMarket', () => {
    it('set perpetual market', async () => {
      await lpToken.setPerpetualMarket(other.address)
    })

    it('reverts if not deployer', async () => {
      await expect(lpToken.connect(other).setPerpetualMarket(other.address)).to.be.revertedWith('Not PerpetualMarket')
    })

    it('reverts if address is 0', async () => {
      await expect(lpToken.setPerpetualMarket(ethers.constants.AddressZero)).to.be.revertedWith('Zero Address')
    })
  })

  describe('mint', () => {
    it('mint 10 tokens', async () => {
      await lpToken.mint(wallet.address, 10)

      expect(await lpToken.balanceOf(wallet.address)).to.be.eq(10)
    })

    it('reverts if not deployer', async () => {
      await expect(lpToken.connect(other).mint(wallet.address, 10)).to.be.revertedWith('Not PerpetualMarket')
    })
  })

  describe('burn', () => {
    beforeEach(async () => {
      await lpToken.mint(wallet.address, 10)
    })

    it('burn 10 tokens', async () => {
      await lpToken.burn(wallet.address, 10)
      expect(await lpToken.balanceOf(wallet.address)).to.be.eq(0)
    })

    it('reverts if not deployer', async () => {
      await expect(lpToken.connect(other).burn(wallet.address, 10)).to.be.revertedWith('Not PerpetualMarket')
    })
  })
})
