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

describe('FlashHedge', function () {
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

    await addWethUsdcLiquidity(ethPriceInUSDC, scaledBN(10, 18), wallet.address, usdc, weth, positionManager, 500)
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
    const vaultId = 0
    const subVaultIndex = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))
    })

    it('buy ETH to hedge', async () => {
      await perpetualMarket.trade({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        marginAmount: MIN_MARGIN,
        limitPrices: [0, 0],
        deadline: 0,
      })

      const before = await usdc.balanceOf(wallet.address)
      await flashHedge.hedgeOnUniswap(0)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)

      // net delta must be neutral
      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[1]).to.be.eq(0)
      expect(tokenAmounts[2]).to.be.eq(0)
    })

    it('reverts if net delta is positive', async () => {
      await perpetualMarket.trade({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 7)],
        marginAmount: MIN_MARGIN,
        limitPrices: [0, 0],
        deadline: 0,
      })

      await expect(flashHedge.hedgeOnUniswap(0)).to.be.revertedWith('FH3')
    })

    it('reverts if ETH price in Uniswap is too high', async () => {
      await perpetualMarket.trade({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        marginAmount: MIN_MARGIN,
        limitPrices: [0, 0],
        deadline: 0,
      })

      await testContractHelper.updateSpot(scaledBN(99, 8))

      await expect(flashHedge.hedgeOnUniswap(0)).to.be.revertedWith('FH1')
    })

    describe('net delta is negative', () => {
      beforeEach(async () => {
        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 7), 0],
          marginAmount: MIN_MARGIN,
          limitPrices: [0, 0],
          deadline: 0,
        })

        await perpetualMarket.execHedge()

        await increaseTime(60 * 60 * 12)
      })

      it('sell ETH to hedge', async () => {
        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-2, 6), 0],
          marginAmount: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('reverts if ETH price in Uniswap is too low', async () => {
        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-2, 6), 0],
          marginAmount: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await testContractHelper.updateSpot(scaledBN(101, 8))

        await expect(flashHedge.hedgeOnUniswap(0)).to.be.revertedWith('FH0')
      })
    })

    describe('net delta is negative because the pool has short perpetual future positions', () => {
      beforeEach(async () => {
        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          marginAmount: MIN_MARGIN,
          limitPrices: [0, 0],
          deadline: 0,
        })

        await perpetualMarket.execHedge()

        await increaseTime(60 * 60 * 12)
      })

      it('net delta is positive and sell all ETH to hedge', async () => {
        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-2, 6)],
          marginAmount: MIN_MARGIN,
          limitPrices: [0, 0],
          deadline: 0,
        })

        const before = await usdc.balanceOf(wallet.address)
        await flashHedge.hedgeOnUniswap(0)
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)

        // net delta must be neutral
        const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
        expect(tokenAmounts[1]).to.be.eq(0)
        expect(tokenAmounts[2]).to.be.eq(0)
      })
    })
  })
})
