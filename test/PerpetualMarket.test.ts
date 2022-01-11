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
  let perpetualMarketWithFunding: PerpetualMarket

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)
  const MinInt128 = BigNumber.from(2).pow(127).sub(1).mul(-1)

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
    perpetualMarketWithFunding = testContractSet.perpetualMarketWithFunding
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
    await usdc.approve(perpetualMarketWithFunding.address, MaxInt128)

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('deposit', () => {
    const poolId = 0
    const vaultId = 0

    describe('failure cases', () => {
      it('reverts if feeLevelLower grater than feeLevelUpper', async () => {
        await expect(
          perpetualMarket.deposit(poolId, scaledBN(1, 6), 110, 100, {
            closeSoon: false,
            vaultId: 0,
          }),
        ).to.be.reverted
      })

      it('reverts if amount is 0', async () => {
        await expect(
          perpetualMarket.deposit(poolId, 0, 100, 110, {
            closeSoon: false,
            vaultId: 0,
          }),
        ).to.be.reverted
      })
    })

    describe('success cases', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, {
          closeSoon: false,
          vaultId: 0,
        })

        const upnl = await testContractSet.perpetualMarketCore.getUnrealizedPnLPerLiquidity(poolId)

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 6))

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

      it('initial deposit', async () => {
        const pool = await testContractSet.perpetualMarketCore.pools(0)
        expect(pool.tradeState.liquidityBefore).to.be.eq(2400000)
      })

      describe('above current level', async () => {
        it('deposit', async () => {
          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(20000000)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })

          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 0,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(-20000000)
        })

        it('add liquidity to liquidityNet', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 40, 50, {
            closeSoon: false,
            vaultId: 0,
          })

          expect((await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 40)).liquidityNet).to.be.eq(1000000)
          expect((await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 50)).liquidityNet).to.be.eq(-1000000)
        })

        it('remove liquidity from liquidityNet', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 40, 50, {
            closeSoon: false,
            vaultId: 0,
          })
          await perpetualMarket.withdraw(2, scaledBN(10, 6), {
            closeSoon: false,
            vaultId: 0,
          })

          expect((await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 40)).liquidityNet).to.be.eq(0)
          expect((await testContractSet.perpetualMarketCore.getFeeLevel(poolId, 50)).liquidityNet).to.be.eq(0)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(21019519)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })

          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 1,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(-10687032)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(10821226)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })

          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.withdraw(2, scaledBN(10, 6), {
            closeSoon: false,
            vaultId: 1,
          })
          const after = await usdc.balanceOf(wallet.address)

          expect(before.sub(after)).to.be.eq(-2490509)
        })
      })
    })

    describe('deposit with closing', () => {
      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, {
          closeSoon: false,
          vaultId: 0,
        })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))
      })

      it('pnl = 0', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
          closeSoon: true,
          vaultId: 1,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(9998693)
      })

      it('pnl > 0', async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))
        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
          closeSoon: true,
          vaultId: 1,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(11953889)
      })

      it('pnl < 0', async () => {
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
          closeSoon: true,
          vaultId: 1,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(8553174)
      })
    })

    describe('unrealized PnL > 0 and realized PnL > 0', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, {
          closeSoon: false,
          vaultId: 0,
        })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(90, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))

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
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(50269995)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 0,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(30269995)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(53368503)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(43702246)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(43046893)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })
          await perpetualMarket.withdraw(2, scaledBN(10, 6), {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(42511107)
        })
      })
    })

    describe('unrealized PnL < 0 and realized PnL < 0', () => {
      let beforeUnrealizedPnLPerLiq: BigNumber

      beforeEach(async () => {
        await perpetualMarket.deposit(poolId, scaledBN(30, 6), 30, 60, {
          closeSoon: false,
          vaultId: 0,
        })

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))

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
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(49909478)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 40, 60, {
            closeSoon: false,
            vaultId: 0,
          })
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 0,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(29909478)
        })
      })

      describe('including current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(49159906)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(20, 6), 20, 40, {
            closeSoon: false,
            vaultId: 1,
          })
          await perpetualMarket.withdraw(2, scaledBN(20, 6), {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(36139897)
        })
      })

      describe('below current level', async () => {
        it('deposit with margin', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(39285501)
        })

        it('withdrawal works after deposit', async () => {
          await perpetualMarket.deposit(poolId, scaledBN(10, 6), 10, 20, {
            closeSoon: false,
            vaultId: 1,
          })
          await perpetualMarket.withdraw(2, scaledBN(10, 6), {
            closeSoon: false,
            vaultId: 1,
          })

          expect(await usdc.balanceOf(testContractSet.liquidityPool.address)).to.be.eq(35349158)
        })
      })
    })
  })

  describe('withdraw', () => {
    const poolId = 0

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(100, 8))
      await perpetualMarket.deposit(poolId, scaledBN(100, 6), 50, 60, {
        closeSoon: false,
        vaultId: 0,
      })
    })

    it('reverts if amount is 0', async function () {
      expect(perpetualMarket.withdraw(1, 0, { closeSoon: false, vaultId: 0 })).to.be.reverted
    })

    it('reverts if caller is not position owner', async function () {
      expect(perpetualMarket.connect(other).withdraw(1, 0, { closeSoon: false, vaultId: 0 })).to.be.reverted
    })

    it('reverts if withdraw with closing but there are no liquidity', async function () {
      await perpetualMarket.openLongPosition(poolId, 0, scaledBN(1, 8), scaledBN(100, 6))

      expect(
        perpetualMarket.withdraw(1, scaledBN(100, 6), {
          closeSoon: true,
          vaultId: 0,
        }),
      ).to.be.reverted
    })

    it('unrealized pnl and realized pnl has not changed', async function () {
      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(1, scaledBN(100, 6), {
        closeSoon: false,
        vaultId: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal(scaledBN(100, 6))
    })

    it('current fee level is in range', async function () {
      await perpetualMarket.openLongPosition(poolId, 0, scaledBN(1, 8), scaledBN(100, 6))

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(1, scaledBN(100, 6), {
        closeSoon: false,
        vaultId: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal('98195981')
    })

    it('unrealized pnl and realized pnl are greater than 0', async function () {
      await perpetualMarket.openLongPosition(poolId, 0, scaledBN(1, 8), scaledBN(100, 6))

      await testContractHelper.updateSpot(scaledBN(90, 8))

      await perpetualMarket.openShortPosition(poolId, 0, scaledBN(1, 8), scaledBN(1, 8))

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(1, scaledBN(100, 6), {
        closeSoon: false,
        vaultId: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal('100190000')
    })

    it('unrealized pnl and realized pnl are less than 0', async function () {
      await perpetualMarket.openLongPosition(poolId, 0, scaledBN(1, 8), scaledBN(100, 6))

      await testContractHelper.updateSpot(scaledBN(110, 8))

      await perpetualMarket.openShortPosition(poolId, 0, scaledBN(1, 8), scaledBN(1, 8))

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(1, scaledBN(100, 6), {
        closeSoon: false,
        vaultId: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal('99790001')
    })
  })

  describe('trade', () => {
    const poolId = 0
    const vaultId = 0

    beforeEach(async () => {
      const amount = scaledBN(8000, 6)
      const feeLevelLower = 80
      const feeLevelUpper = 82

      await perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper, { closeSoon: false, vaultId: 0 })

      await usdc.approve(perpetualMarket.address, MaxInt128)
      await usdc.connect(other).approve(perpetualMarket.address, MaxInt128)
    })

    it('open long position of 2 size', async () => {
      const size = scaledBN(2, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      const before = await testContractSet.traderVaults.getVault(wallet.address, vaultId)
      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))
      const after = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size)

      const pool = await testContractSet.perpetualMarketCore.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gte(80)

      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))
    })

    it('open long position of 10 size', async () => {
      const size = scaledBN(10, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1005, 8))

      await usdc.approve(perpetualMarket.address, maxFee)

      const before = await testContractSet.traderVaults.getVault(wallet.address, vaultId)
      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))
      const after = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size)
    })

    it('open 2 long and close 1 long', async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await usdc.approve(perpetualMarket.address, maxFee)
      await perpetualMarket.openLongPosition(poolId, vaultId, longSize, scaledBN(1, 8))

      await perpetualMarket.openShortPosition(poolId, vaultId, shortSize, scaledBN(1, 8))

      const vault = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(1, 6))
    })

    it('open 2 long and close 2 long', async () => {
      const size = scaledBN(2, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))

      const before = await testContractSet.traderVaults.getVault(wallet.address, vaultId)
      await perpetualMarket.openShortPosition(poolId, vaultId, size, scaledBN(1, 8))
      const after = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size.mul(-1))
    })

    it('open 2 long and open 1 short', async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, longSize, scaledBN(1, 8))

      await perpetualMarket.connect(other).openShortPosition(poolId, vaultId, shortSize, scaledBN(1, 8))

      const vault = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6))
    })

    it('open 2 long and 2 short, and close 1 short', async () => {
      const size = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))

      await perpetualMarket.connect(other).openShortPosition(poolId, vaultId, size, scaledBN(1, 8))

      await perpetualMarket.connect(other).openLongPosition(poolId, vaultId, shortSize, scaledBN(1, 8))

      const vault = await testContractSet.traderVaults.getVault(wallet.address, vaultId)
      const otherVault = await testContractSet.traderVaults.getVault(other.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6))
      expect(otherVault.size[0]).to.equal(scaledBN(-1, 6))
    })

    it('open 2 long and price changed', async () => {
      const size = scaledBN(5, 6)
      const maxFee = scaledBN(2000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      await perpetualMarket.openLongPosition(poolId, vaultId, size, scaledBN(1, 8))

      const vault = await testContractSet.traderVaults.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(10, 6))
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

      await perpetualMarket.deposit(sqeethPoolId, amount, feeLevelLower, feeLevelUpper, {
        vaultId: 0,
        closeSoon: false,
      })
      await perpetualMarket.deposit(futurePoolId, amount, feeLevelLower, feeLevelUpper, {
        vaultId: 0,
        closeSoon: false,
      })

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    describe('Sqeeth', () => {
      it('open', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
      })

      it('close position', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close position with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('2100')
      })

      it('close position with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          imRatio: scaledBN(1, 8),
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
          imRatio: scaledBN(1, 8),
        })
      })

      it('close', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99999')
      })

      it('close with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
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
          imRatio: scaledBN(1, 8),
        })
      })

      it('close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('0')
      })

      it('close Sqeeth', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-195998')
      })

      it('close Future', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-1961')
      })

      it('close positions with price move', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })
        await testContractHelper.updateSpot(scaledBN(110, 8))
        await perpetualMarket.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('102099')
      })
    })
  })

  describe.skip('openPositions with Funding Fee', () => {
    const sqeethPoolId = 0
    const futurePoolId = 1
    const vaultId = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)
      const feeLevelLower = 50
      const feeLevelUpper = 55

      await perpetualMarketWithFunding.deposit(sqeethPoolId, amount, feeLevelLower, feeLevelUpper, {
        vaultId: 0,
        closeSoon: false,
      })
      await perpetualMarketWithFunding.deposit(futurePoolId, amount, feeLevelLower, feeLevelUpper, {
        vaultId: 0,
        closeSoon: false,
      })

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    describe('Sqeeth', () => {
      it('close position with funding fee', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), 0],
          imRatio: scaledBN(1, 8),
        })

        await increaseTime(60 * 60 * 24)

        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), 0],
          imRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99999999')
      })
    })

    describe('Future', () => {
      it('close with funding fee', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [0, scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })

        await increaseTime(60 * 60 * 24)

        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [0, scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99999999')
      })
    })

    describe('Sqeeth and Future', () => {
      it('close positions with funding fee', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [scaledBN(1, 6), scaledBN(1, 6)],
          imRatio: scaledBN(1, 8),
        })

        await increaseTime(60 * 60 * 24)

        await perpetualMarketWithFunding.openPositions({
          vaultId,
          sizes: [scaledBN(-1, 6), scaledBN(-1, 6)],
          imRatio: scaledBN(1, 8),
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99999999')
      })
    })
  })
})
