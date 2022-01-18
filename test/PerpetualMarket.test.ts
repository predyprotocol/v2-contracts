import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { increaseTime, scaledBN } from './utils/helpers'

describe('PerpetualMarket', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)
  const MinInt128 = BigNumber.from(2).pow(127).sub(1).mul(-1)

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    // mint 2^127 - 1 ETH
    const testAmount = MaxInt128
    await weth.mint(wallet.address, testAmount)

    // mint 2^127 - 1 USDC
    const testUsdcAmount = MaxInt128
    await usdc.mint(wallet.address, testUsdcAmount)
    await usdc.mint(other.address, testUsdcAmount)

    await usdc.approve(perpetualMarket.address, MaxInt128)

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('initialize', () => {
    describe('failure cases', () => {
      it('reverts if amount is 0', async () => {
        await expect(perpetualMarket.initialize(0, 100)).to.be.reverted
      })

      it('reverts if funding rate is 0', async () => {
        await expect(perpetualMarket.initialize(100, 0)).to.be.reverted
      })
    })

    describe('success cases', () => {
      it('initialize pool', async () => {
        await perpetualMarket.initialize(100, 100)
      })
    })
  })

  describe('deposit', () => {
    const vaultId = 0

    describe('failure cases', () => {
      it('reverts if amount is 0', async () => {
        await expect(perpetualMarket.deposit(0)).to.be.reverted
      })
    })

    describe('success cases', () => {
      beforeEach(async () => {
        await perpetualMarket.initialize(scaledBN(30, 6), 30)
      })

      it('deposit', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(scaledBN(20, 6))
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(20000000)
      })

      it('withdrawal works after deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.withdraw(scaledBN(20, 6))
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(-20000000)
      })
    })

    describe('unrealized PnL > 0 and realized PnL > 0', () => {
      beforeEach(async () => {
        await perpetualMarket.deposit(scaledBN(30, 6))

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(90, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))
      })

      it('deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))

        expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.gt(50000000)
      })

      it('withdrawal works after deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))
        await perpetualMarket.withdraw(scaledBN(20, 6))

        expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.gt(30000000)
      })
    })

    describe('unrealized PnL < 0 and realized PnL < 0', () => {
      beforeEach(async () => {
        await perpetualMarket.deposit(scaledBN(30, 6))

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))
      })

      it('deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))

        expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.lt(50000000)
      })

      it('withdrawal works after deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))
        await perpetualMarket.withdraw(scaledBN(20, 6))

        expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.lt(30000000)
      })
    })
  })

  describe('withdraw', () => {
    const poolId = 0

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(100, 8))
      await perpetualMarket.deposit(scaledBN(100, 6))
    })

    it('reverts if amount is 0', async function () {
      expect(perpetualMarket.withdraw(0)).to.be.reverted
    })

    it('reverts if caller is not position owner', async function () {
      expect(perpetualMarket.connect(other).withdraw(100)).to.be.reverted
    })

    it('reverts if withdraw with closing but there are no liquidity', async function () {
      await perpetualMarket.openLongPosition(poolId, 0, scaledBN(1, 8), scaledBN(100, 6))

      expect(perpetualMarket.withdraw(scaledBN(100, 6))).to.be.reverted
    })

    it('unrealized pnl and realized pnl has not changed', async function () {
      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(scaledBN(100, 6))
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal(scaledBN(100, 6))
    })
  })

  describe('openPositions', () => {
    const sqeethPoolId = 0
    const futurePoolId = 1
    const vaultId = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)
      const feeLevelLower = 50
      const feeLevelUpper = 55

      await perpetualMarket.initialize(amount, feeLevelLower)

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    describe('Sqeeth', () => {
      it('open', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
      })

      it('close position', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close position with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('2100')
      })

      it('close position with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-1900')
      })
    })

    describe('Future', () => {
      it('open', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
      })

      it('close', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99999')
      })

      it('close with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-100000')
      })
    })

    describe('Sqeeth and Future', () => {
      it('open Sqeeth and Future contracts', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
      })

      it('close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close Sqeeth', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-195998')
      })

      it('close Future', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-1961')
      })

      it('close positions with price move', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('102099')
      })
    })
  })
})
