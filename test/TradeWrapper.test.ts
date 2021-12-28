import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, TradeWrapper } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { increaseTime, scaledBN } from "./utils/helpers";

describe("TradeWrapper", function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let tradeWrapper: TradeWrapper

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)
  const MinInt128 = BigNumber.from(2).pow(127).sub(1).mul(-1)

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    tradeWrapper = testContractSet.tradeWrapper
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

    await usdc.approve(testContractSet.perpetualMarket.address, MaxInt128)
    await usdc.approve(testContractSet.tradeWrapper.address, MaxInt128)

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe("deposit", () => {
    const poolId = 0
    const vaultId = 0

    it("deposit 1 usdc", async () => {
      await tradeWrapper.deposit(poolId, scaledBN(1, 6), 100, 110)
    })

    it("deposit into lower", async () => {
      await tradeWrapper.deposit(poolId, scaledBN(5, 6), 10, 60)

      await testContractHelper.openLong(wallet, vaultId, scaledBN(18, 5), scaledBN(100, 6))

      const pool = await testContractSet.perpetualMarket.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gt(50)

      await tradeWrapper.deposit(poolId, scaledBN(1, 6), 10, 12)
    })

    describe("deposit after unrealized PnL changed", () => {
      const amount = scaledBN(1, 6)
      const feeLevelLower = 50
      const feeLevelUpper = 60

      beforeEach(async () => {
        await tradeWrapper.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, 20000, scaledBN(1, 6))
      })

      it("deposit after unrealized PnL becomes larger", async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))

        const pool1 = await testContractSet.perpetualMarket.pools(poolId)
        console.log('fee level', pool1.tradeState.currentFeeLevelIndex.toString())

        await testContractHelper.openShort(wallet, vaultId, 10000, 0)

        const pool2 = await testContractSet.perpetualMarket.pools(poolId)
        console.log('fee level', pool2.tradeState.currentFeeLevelIndex.toString())

        const beforeUnrealizedPnLPerLiq = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)
        const poolBefore = await testContractSet.perpetualMarket.pools(poolId)

        await tradeWrapper.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        const afterUnrealizedPnLPerLiq = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)
        const poolAfter = await testContractSet.perpetualMarket.pools(poolId)


        // expect(poolBefore.tradeState.liquidityBefore).to.be.lt(poolAfter.tradeState.liquidityBefore)

        expect(beforeUnrealizedPnLPerLiq).to.be.eq(afterUnrealizedPnLPerLiq)
      })

      it("deposit after unrealized PnL becomes smaller", async () => {
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, 10000, 0)

        const beforeUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)

        await tradeWrapper.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        const afterUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnL).to.be.eq(afterUnrealizedPnL)
      })
    })
  })

  describe("withdraw", () => {
    const poolId = 0

    it("withdraw 1 usdc", async function () {
      const amount = scaledBN(1, 6)
      const feeLevelLower = 100
      const feeLevelUpper = 120

      await tradeWrapper.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

      const before = await usdc.balanceOf(wallet.address)
      await tradeWrapper.withdraw(poolId, amount, feeLevelLower, feeLevelUpper)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal(amount);
    })

    it("collect fee", async function () {
      const amount = scaledBN(1000, 6)
      const feeLevelLower = 100
      const feeLevelUpper = 120
      const vaultId = 0

      await tradeWrapper.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

      // trades
      const depositCollateral = scaledBN(2000, 6)
      await testContractHelper.updateSpot(scaledBN(1000, 8))
      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, scaledBN(1, 8), depositCollateral)
      await testContractHelper.updateSpot(scaledBN(900, 8))
      await testContractSet.tradeWrapper.openShortPosition(poolId, vaultId, scaledBN(1, 8), 0)

      // withdraw fee
      const before = await usdc.balanceOf(wallet.address)
      await tradeWrapper.withdraw(poolId, amount, feeLevelLower, feeLevelUpper)
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

      await usdc.approve(testContractSet.perpetualMarket.address, amount)
      await testContractSet.perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

      await usdc.approve(testContractSet.tradeWrapper.address, MaxInt128)
      await usdc.connect(other).approve(testContractSet.tradeWrapper.address, MaxInt128)
    })

    it("open long position of 2 size", async () => {
      const size = scaledBN(2, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      const before = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)
      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)
      const after = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size);

      const pool = await testContractSet.perpetualMarket.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gte(80)

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)
    })

    it("open long position of 10 size", async () => {
      const size = scaledBN(10, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1005, 8))

      await usdc.approve(testContractSet.tradeWrapper.address, maxFee)

      const before = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)
      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)
      const after = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size);
    })

    it("open 2 long and close 1 long", async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await usdc.approve(testContractSet.tradeWrapper.address, maxFee)
      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, longSize, maxFee)

      await testContractSet.tradeWrapper.openShortPosition(poolId, vaultId, shortSize, 0)

      const vault = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(1, 6));
    })

    it("open 2 long and close 2 long", async () => {
      const size = scaledBN(2, 6)
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)

      const before = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)
      await testContractSet.tradeWrapper.openShortPosition(poolId, vaultId, size, 0)
      const after = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(after.size[0].sub(before.size[0])).to.equal(size.mul(-1));
    })

    it("open 2 long and open 1 short", async () => {
      const longSize = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0;
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, longSize, maxFee)

      await testContractSet.tradeWrapper.connect(other).openShortPosition(poolId, vaultId, shortSize, maxFee)

      const vault = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6));
    })

    it("open 2 long and 2 short, and close 1 short", async () => {
      const size = scaledBN(2, 6)
      const shortSize = scaledBN(1, 6)
      const vaultId = 0;
      const maxFee = scaledBN(1000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)

      await testContractSet.tradeWrapper.connect(other).openShortPosition(poolId, vaultId, size, maxFee)

      await testContractSet.tradeWrapper.connect(other).openLongPosition(poolId, vaultId, shortSize, 0)

      const vault = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)
      const otherVault = await testContractSet.perpetualMarket.getVault(other.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(2, 6));
      expect(otherVault.size[0]).to.equal(scaledBN(-1, 6));
    })

    it("open 2 long and price changed", async () => {
      const size = scaledBN(5, 6)
      const maxFee = scaledBN(2000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      await testContractSet.tradeWrapper.openLongPosition(poolId, vaultId, size, maxFee)

      const vault = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

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

      await usdc.approve(testContractSet.perpetualMarket.address, MaxInt128)

      await testContractSet.perpetualMarket.deposit(sqeethPoolId, amount, feeLevelLower, feeLevelUpper)
      await testContractSet.perpetualMarket.deposit(futurePoolId, amount, feeLevelLower, feeLevelUpper)

      await usdc.approve(testContractSet.tradeWrapper.address, MaxInt128)
      await usdc.connect(other).approve(testContractSet.tradeWrapper.address, MaxInt128)
    })

    it("open Sqeeth and short future contracts", async () => {
      const size = scaledBN(2, 6)
      const depositOrWithdrawAmount = scaledBN(2000, 6)

      await testContractHelper.updateSpot(scaledBN(1002, 8))

      await testContractSet.tradeWrapper.connect(other).openPositions({ vaultId, sizes: [100, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      const beforeUsdcBalance = await usdc.balanceOf(wallet.address)

      const tx = await testContractSet.tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(1, 5), scaledBN(-1, 8)], depositOrWithdrawAmount })
      const receipt = await tx.wait()

      // The gas usage of opening Sqeeth and short future is less than 400k gas
      expect(receipt.gasUsed).to.be.lt(500000)

      const vault = await testContractSet.perpetualMarket.getVault(wallet.address, vaultId)

      expect(vault.size[0]).to.equal(scaledBN(1, 5));
      expect(vault.size[1]).to.equal(scaledBN(-1, 8));

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1005, 8))

      await testContractSet.tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(-1, 5), scaledBN(1, 8)], depositOrWithdrawAmount: MinInt128 })

      const afterUsdcBalance = await usdc.balanceOf(wallet.address)

      expect(afterUsdcBalance.sub(beforeUsdcBalance)).to.be.gt(0);
    })
  })
})
