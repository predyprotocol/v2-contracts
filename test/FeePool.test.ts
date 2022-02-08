import { ethers } from 'hardhat'
import { expect } from 'chai'
import { FeePool, MockERC20, MockWETH } from '../typechain'
import { Wallet } from 'ethers'
import { scaledBN } from './utils/helpers'

describe('FeePool', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20
  let feePool: FeePool

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    const MockWETH = await ethers.getContractFactory('MockWETH')
    const MockERC20 = await ethers.getContractFactory('MockERC20')

    weth = (await MockWETH.deploy('WETH', 'WETH', 18)) as MockWETH
    usdc = (await MockERC20.deploy('USDC', 'USDC', 6)) as MockERC20

    const FeePool = await ethers.getContractFactory('FeePool')
    feePool = (await FeePool.deploy(usdc.address)) as FeePool

    // mint 100 USDC
    const testUsdcAmount = scaledBN(100000, 6)
    await usdc.mint(wallet.address, testUsdcAmount)
  })

  describe('withdraw', () => {
    const profit = scaledBN(5000, 6)

    it('withdraw profit', async () => {
      await usdc.approve(feePool.address, profit)
      await feePool.sendProfitERC20(wallet.address, profit)

      const before = await usdc.balanceOf(wallet.address)
      await feePool.withdraw(wallet.address, profit)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.eq(profit)
    })

    it('reverts if caller is not owner', async () => {
      await usdc.approve(feePool.address, profit)
      await feePool.sendProfitERC20(wallet.address, profit)

      await expect(feePool.connect(other).withdraw(wallet.address, profit)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
  })
})
