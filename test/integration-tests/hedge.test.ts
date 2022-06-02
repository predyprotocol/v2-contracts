import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../../typechain'
import { BigNumber, constants, Wallet } from 'ethers'
import {
  addWethUsdcLiquidity,
  createUniPool,
  deployFlashHedge,
  deployTestContractSet,
  deployUniswapV3,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from '../utils/deploy'
import { increaseTime, scaledBN } from '../utils/helpers'
import { FlashHedge } from '../../typechain/FlashHedge'
import { MIN_MARGIN } from '../utils/constants'

describe('integration.FlashHedge', function () {
  let wallet: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket
  let flashHedge: FlashHedge

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)

  const ethPriceInUSDC = 100

  async function execRawHedge() {
    await perpetualMarket.setHedger(wallet.address)
    await perpetualMarket.execHedge(true)
    await perpetualMarket.setHedger(flashHedge.address)
  }

  before(async () => {
    ;[wallet] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket

    await weth.mint(wallet.address, constants.MaxUint256)
    await usdc.mint(wallet.address, constants.MaxUint256)

    // set up uniswap
    const { uniswapFactory, positionManager } = await deployUniswapV3(weth)

    const ethUsdcPool = await createUniPool(ethPriceInUSDC, usdc, weth, positionManager, uniswapFactory, 500)

    flashHedge = await deployFlashHedge(weth, usdc, perpetualMarket, uniswapFactory, positionManager, ethUsdcPool)

    await addWethUsdcLiquidity(ethPriceInUSDC, scaledBN(100, 18), wallet.address, usdc, weth, positionManager, 500)
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    // approve
    await weth.approve(perpetualMarket.address, MaxInt128)
    await usdc.approve(perpetualMarket.address, MaxInt128)

    // ETH spot price is $100
    await testContractHelper.updateSpot(scaledBN(ethPriceInUSDC, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('hedgeOnUniswap', () => {
    beforeEach(async () => {
      const amount = scaledBN(1000, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))
    })

    it('buy ETH to hedge', async () => {
      await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 6)], MIN_MARGIN)

      const before = await usdc.balanceOf(wallet.address)
      await flashHedge.hedgeOnUniswap(0, true)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)

      // net delta must be neutral
      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[1]).to.be.eq(0)
      expect(tokenAmounts[2]).to.be.eq(0)
    })

    it('without rebalance', async () => {
      await testContractHelper.trade(wallet, 0, [scaledBN(8, 8), 0], scaledBN(5000, 6))

      await testContractHelper.updateSpot(scaledBN(120, 8))

      await expect(flashHedge.hedgeOnUniswap(0, true)).to.be.revertedWith('PMC1')

      await flashHedge.hedgeOnUniswap(0, false)

      // net delta must be neutral
      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[1]).to.be.eq(0)
      expect(tokenAmounts[2]).to.be.eq(0)
    })

    it('reverts if net delta is positive', async () => {
      await testContractHelper.trade(wallet, 0, [scaledBN(-1, 7), scaledBN(1, 6)], MIN_MARGIN)

      await expect(flashHedge.hedgeOnUniswap(0, true)).to.be.revertedWith('FH3')
    })

    it('reverts if ETH price in Uniswap is too high', async () => {
      await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 6)], MIN_MARGIN)

      await testContractHelper.updateSpot(scaledBN(99, 8))

      await expect(flashHedge.hedgeOnUniswap(0, true)).to.be.revertedWith('FH1')
    })

    describe('net delta is negative', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 7)], MIN_MARGIN)

        await execRawHedge()

        await increaseTime(60 * 60 * 12)
      })

      it('sell ETH to hedge', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-2, 6)], scaledBN(1, 8))

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0, true)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('reverts if ETH price in Uniswap is too low', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-2, 6)], scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(101, 8))

        await expect(flashHedge.hedgeOnUniswap(0, true)).to.be.revertedWith('FH0')
      })
    })

    describe('net delta is negative(short future)', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(1, 6), 0], MIN_MARGIN)

        await execRawHedge()

        await increaseTime(60 * 60 * 12)
      })

      it('net delta is positive and sell all ETH to hedge', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-2, 6), 0], MIN_MARGIN)

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0, true)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)

        // net delta must be neutral
        const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
        expect(tokenAmounts[1]).to.be.eq(0)
        expect(tokenAmounts[2]).to.be.eq(0)
      })
    })

    describe('net delta is negative(short future and short squared)', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(1, 6), scaledBN(1, 6)], MIN_MARGIN)

        await execRawHedge()

        await increaseTime(60 * 60 * 12)
      })

      afterEach(async () => {
        // net delta must be neutral
        const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
        expect(tokenAmounts[1]).to.be.eq(0)
        expect(tokenAmounts[2]).to.be.eq(0)
      })

      it('net delta becomes positive and sell all ETH to hedge', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-3, 6), 0], MIN_MARGIN)

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0, true)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('net delta becomes positive by short squared and sell all ETH to hedge', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-20, 6)], MIN_MARGIN)

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0, true)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })
    })
  })
})
