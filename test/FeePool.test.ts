import { ethers } from 'hardhat'
import { expect } from 'chai'
import { FeePool, MockERC20 } from '../typechain'
import { Wallet } from 'ethers'
import { scaledBN } from './utils/helpers'

describe('FeePool', function () {
  let wallet: Wallet, other: Wallet
  let usdc: MockERC20
  let feePool: FeePool

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    const MockERC20 = await ethers.getContractFactory('MockERC20')

    usdc = (await MockERC20.deploy('USDC', 'USDC', 6)) as MockERC20

    const FeePool = await ethers.getContractFactory('FeePool')
    feePool = (await FeePool.deploy(usdc.address)) as FeePool

    await usdc.mint(wallet.address, ethers.constants.MaxUint256)
    await usdc.approve(feePool.address, ethers.constants.MaxUint256)
  })

  describe('withdraw', () => {
    const profit = scaledBN(5000, 6)

    it('withdraw profit', async () => {
      await feePool.sendProfitERC20(wallet.address, profit)

      const before = await usdc.balanceOf(wallet.address)
      await feePool.withdraw(wallet.address, profit)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.eq(profit)
    })

    it('reverts if caller is not owner', async () => {
      await feePool.sendProfitERC20(wallet.address, profit)

      await expect(feePool.connect(other).withdraw(wallet.address, profit)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
  })
})
