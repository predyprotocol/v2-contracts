import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, PerpetualMarket } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { increaseTime, scaledBN } from "./utils/helpers";

describe("PerpetualMarket", function () {
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

  describe("deposit", () => {
    const poolId = 0
    const vaultId = 0

    describe("failure cases", () => {
      it("reverts if feeLevelLower grater than feeLevelUpper", async () => {
        await expect(perpetualMarket.deposit(poolId, scaledBN(1, 6), 110, 100, { closeSoon: false, vaultId: 0 })).to.be.reverted
      })

      it("reverts if amount is 0", async () => {
        await expect(perpetualMarket.deposit(poolId, 0, 100, 110, { closeSoon: false, vaultId: 0 })).to.be.reverted
      })
    })

    describe('success cases', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, { closeSoon: false, vaultId: 0 })

        const upnl = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 6), scaledBN(10, 6))

        const pool = await testContractSet.perpetualMarketCore.pools(poolId)
        expect(pool.tradeState.currentFeeLevelIndex).to.be.eq(32)
        expect(pool.tradeState.liquidityBefore).to.be.eq(2400000)
        expect(pool.tradeState.feeLevelMultipliedLiquidityGlobal).to.be.eq(2407500)

        beforeUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

      })

      afterEach(async () => {
        const afterUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnLPerLiq).to.be.gte(afterUnrealizedPnLPerLiq.sub(1))
        expect(beforeUnrealizedPnLPerLiq).to.be.lte(afterUnrealizedPnLPerLiq.add(1))
      })

      it("initial deposit", async () => {
        const pool = await testContractSet.perpetualMarketCore.pools(0)
        expect(
          pool.tradeState.liquidityBefore
        ).to.be.eq(2400000)
      })

      describe('above current level', async () => {

        it('deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(60000000)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(40000000)
        })

        it('add liquidity to liquidityNet', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 40, 50, { closeSoon: false, vaultId: 0 })

          expect(
            (await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 40)).liquidityNet
          ).to.be.eq(1000000)
          expect(
            (await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 50)).liquidityNet
          ).to.be.eq(-1000000)
        })

        it('remove liquidity from liquidityNet', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 40, 50, { closeSoon: false, vaultId: 0 })
          await perpetualMarket.withdraw(poolId, scaledBN(10, 6), 40, 50, { closeSoon: false, vaultId: 0 })

          expect(
            (await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 40)).liquidityNet
          ).to.be.eq(0)
          expect(
            (await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 50)).liquidityNet
          ).to.be.eq(0)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(61019519)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })


          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(50332487)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1, })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(50821226)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1, })
          await perpetualMarket.withdraw(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1, })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(48330717)
        })
      })
    })

    describe('deposit with closing', () => {
      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, { closeSoon: false, vaultId: 0 })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8), scaledBN(100, 6))
      })

      it('pnl = 0', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: true, vaultId: 1 })
        const after = await usdc.balanceOf(wallet.address)

        expect(
          before.sub(after)
        ).to.be.eq(9998693)
      })

      it('pnl > 0', async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))
        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7), 0)

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: true, vaultId: 1 })
        const after = await usdc.balanceOf(wallet.address)

        expect(
          before.sub(after)
        ).to.be.eq(11953889)
      })

      it('pnl < 0', async () => {
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7), 0)

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: true, vaultId: 1 })
        const after = await usdc.balanceOf(wallet.address)

        expect(
          before.sub(after)
        ).to.be.eq(8553174)
      })

    })

    describe('unrealized PnL > 0 and realized PnL > 0', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, { closeSoon: false, vaultId: 0 })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8), scaledBN(100, 6))

        await testContractHelper.updateSpot(scaledBN(90, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7), 0)

        beforeUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnLPerLiq).to.be.gt(scaledBN(1, 8))
      })

      afterEach(async () => {
        const afterUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnLPerLiq).to.be.gte(afterUnrealizedPnLPerLiq.sub(1))
        expect(beforeUnrealizedPnLPerLiq).to.be.lte(afterUnrealizedPnLPerLiq.add(1))
      })

      describe('above current level', async () => {

        it('deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(150000000)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(130000000)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })


          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(153098508)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(143432251)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(142776898)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })
          await perpetualMarket.withdraw(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(142241112)
        })
      })
    })

    describe('unrealized PnL < 0 and realized PnL < 0', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, { closeSoon: false, vaultId: 0 })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8), scaledBN(100, 6))

        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7), 0)

        beforeUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnLPerLiq).to.be.lt(scaledBN(1, 8))
      })

      afterEach(async () => {
        const afterUnrealizedPnLPerLiq = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnLPerLiq).to.be.gte(afterUnrealizedPnLPerLiq.sub(1))
        expect(beforeUnrealizedPnLPerLiq).to.be.lte(afterUnrealizedPnLPerLiq.add(1))
      })

      describe('above current level', async () => {

        it('deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(150000000)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 40, 60, { closeSoon: false, vaultId: 0 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(130000000)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          const tx = await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })

          const receipt = await tx.wait()

          const depositedAmount = receipt.events?.filter((x) => x.event === 'Deposited')[0].args?.amount

          console.log('depositedAmount', depositedAmount.toString())

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(149250428)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })
          await perpetualMarket.withdraw(poolId, scaledBN(20, 6), 20, 40, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(136230419)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(139376023)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })
          await perpetualMarket.withdraw(poolId, scaledBN(10, 6), 10, 20, { closeSoon: false, vaultId: 1 })

          expect(
            await usdc.balanceOf(testContractSet.liquidityPool.address)
          ).to.be.eq(135439680)
        })
      })
    })
  })

  describe("withdraw", () => {
    const poolId = 0

    it("withdraw 1 usdc", async function () {
      const amount = scaledBN(1, 6)
      const feeLevelLower = 100
      const feeLevelUpper = 120

      await perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal(amount);
    })

    it("collect fee", async function () {
      const amount = scaledBN(200, 6)
      const feeLevelLower = 100
      const feeLevelUpper = 120
      const vaultId = 0

      await perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })

      // trades
      const depositCollateral = scaledBN(2000, 6)
      await testContractHelper.updateSpot(scaledBN(1000, 8))
      await perpetualMarket.openLongPosition(poolId, vaultId, scaledBN(2, 7), depositCollateral)
      await testContractHelper.updateSpot(scaledBN(900, 8))
      await perpetualMarket.openShortPosition(poolId, vaultId, scaledBN(2, 7), 0)

      // withdraw fee
      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.gt(amount);
    })

  })

  describe("trade", () => {
    const poolId = 0
    const vaultId = 0;

    beforeEach(async () => {
      const amount = scaledBN(8000, 6)
      const feeLevelLower = 80
      const feeLevelUpper = 82

      await perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })

      await usdc.approve(perpetualMarket.address, MaxInt128)
      await usdc.connect(other).approve(perpetualMarket.address, MaxInt128)
    })

    it("open long position of 2 size", async () => {
      const size = scaledBN(2, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      const before = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)
      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)
      const after = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size);

      const pool = await testContractSet.perpetualMarketCore.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gte(80)

      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)
    })

    it("open long position of 10 size", async () => {
      const size = scaledBN(10, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1005, 8))

      await usdc.approve(perpetualMarket.address, maxFee)

      const before = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)
      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)
      const after = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size);
    })

    it("open 2 long and close 1 long", async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await usdc.approve(perpetualMarket.address, maxFee)
      await perpetualMarket.openLongPosition(poolId, vaultId, longSize, maxFee)

      await perpetualMarket.openShortPosition(poolId, vaultId, shortSize, 0)

      const vault = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(1, 6));
    })

    it("open 2 long and close 2 long", async () => {
      const size = scaledBN(2, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)

      const before = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)
      await perpetualMarket.openShortPosition(poolId, vaultId, size, 0)
      const after = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size.mul(-1));
    })

    it("open 2 long and open 1 short", async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0;
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, longSize, maxFee)

      await perpetualMarket.connect(other).openShortPosition(poolId, vaultId, shortSize, maxFee)

      const vault = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6));
    })

    it("open 2 long and 2 short, and close 1 short", async () => {
      const size = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0;
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)

      await perpetualMarket.connect(other).openShortPosition(poolId, vaultId, size, maxFee)

      await perpetualMarket.connect(other).openLongPosition(poolId, vaultId, shortSize, 0)

      const vault = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)
      const otherVault = await testContractSet.perpetualMarketCore.getVault(other.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6));
      expect(otherVault.size[0]).to.equal(scaledBN(-1, 6));
    })

    it("open 2 long and price changed", async () => {
      const size = scaledBN(5, 6)
      const maxFee = scaledBN(2000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, maxFee)

      const vault = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(10, 6));
    })
  })

  describe("openPositions", () => {
    const sqeethPoolId = 0
    const futurePoolId = 1
    const vaultId = 0;

    beforeEach(async () => {
      const amount = scaledBN(15000, 6)
      const feeLevelLower = 80
      const feeLevelUpper = 85

      await usdc.approve(testContractSet.perpetualMarketCore.address, MaxInt128)

      await testContractSet.perpetualMarketCore.deposit(sqeethPoolId, amount, feeLevelLower, feeLevelUpper)
      await testContractSet.perpetualMarketCore.deposit(futurePoolId, amount, feeLevelLower, feeLevelUpper)

      await usdc.approve(perpetualMarket.address, MaxInt128)
      await usdc.connect(other).approve(perpetualMarket.address, MaxInt128)
    })

    it("open Sqeeth and short future contracts", async () => {
      const size = scaledBN(2, 6)
      const depositOrWithdrawAmount = scaledBN(2000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.connect(other).openPositions({ vaultId, sizes: [100, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      const beforeUsdcBalance = await usdc.balanceOf(wallet.address)

      const tx = await perpetualMarket.openPositions({ vaultId, sizes: [scaledBN(1, 5), scaledBN(-1, 8)], depositOrWithdrawAmount })
      const receipt = await tx.wait()

      // The gas usage of opening Sqeeth and short future is less than 400k gas
      expect(receipt.gasUsed).to.be.lt(500000)

      const vault = await testContractSet.perpetualMarketCore.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(1, 5));
      expect(vault.size[1]).to.equal(scaledBN(-1, 8));

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1005, 8))

      await perpetualMarket.openPositions({ vaultId, sizes: [scaledBN(-1, 5), scaledBN(1, 8)], depositOrWithdrawAmount: MinInt128 })

      const afterUsdcBalance = await usdc.balanceOf(wallet.address)

      expect(afterUsdcBalance.sub(beforeUsdcBalance)).to.be.gt(0);
    })
  })
})
