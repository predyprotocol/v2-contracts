import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, PerpetualMarket } from '../typechain'
import { BigNumber, BigNumberish, ContractTransaction, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { increaseTime, scaledBN } from "./utils/helpers";

async function checkGas(tx: ContractTransaction, upperGas: BigNumberish) {
  const receipt = await tx.wait()

  console.log(receipt.gasUsed)

  expect(receipt.gasUsed).to.be.lte(upperGas)
}

describe("TradeWrapper gas test", function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let tradeWrapper: PerpetualMarket

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)
  const MinInt128 = BigNumber.from(2).pow(127).sub(1).mul(-1)

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    tradeWrapper = testContractSet.perpetualMarket
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
      const tx = await tradeWrapper.deposit(poolId, scaledBN(1, 6), 100, 110, 0, 0)

      await checkGas(tx, 215584)
    })

    it("deposit around current level", async () => {
      await tradeWrapper.deposit(poolId, scaledBN(5, 6), 10, 60, 0, 0)

      await testContractHelper.openLong(wallet, vaultId, scaledBN(18, 5), scaledBN(100, 6))

      const pool = await testContractSet.perpetualMarketCore.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gt(50)

      const tx = await tradeWrapper.deposit(poolId, scaledBN(1, 6), 45, 55, 0, 0)

      await checkGas(tx, 312822)
    })
    it("deposit into lower", async () => {
      await tradeWrapper.deposit(poolId, scaledBN(5, 6), 10, 60, 0, 0)

      await testContractHelper.openLong(wallet, vaultId, scaledBN(18, 5), scaledBN(100, 6))

      const pool = await testContractSet.perpetualMarketCore.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gt(50)

      const tx = await tradeWrapper.deposit(poolId, scaledBN(1, 6), 10, 12, 0, 0)

      await checkGas(tx, 557793)
    })

    it("deposit into lower range", async () => {
      await tradeWrapper.deposit(poolId, scaledBN(6, 6), 10, 70, 0, 0)

      await testContractHelper.openLong(wallet, vaultId, scaledBN(20, 5), scaledBN(100, 6))

      const pool = await testContractSet.perpetualMarketCore.pools(poolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gt(52)

      const tx = await tradeWrapper.deposit(poolId, scaledBN(1, 6), 10, 50, 0, 0)

      await checkGas(tx, 588919)
    })
  })

  describe("openPositions", () => {
    const sqeethPoolId = 0
    const futurePoolId = 1
    const vaultId = 0;

    const size = scaledBN(2, 6)
    const depositOrWithdrawAmount = scaledBN(2000, 6)

    beforeEach(async () => {
      const amount = scaledBN(20000, 6)
      const feeLevelLower = 80
      const feeLevelUpper = 100

      await tradeWrapper.deposit(sqeethPoolId, amount, feeLevelLower, feeLevelUpper, 0, 0)
      await tradeWrapper.deposit(futurePoolId, amount, feeLevelLower, feeLevelUpper, 0, 0)

      await usdc.connect(other).approve(tradeWrapper.address, MaxInt128)

      await testContractHelper.updateSpot(scaledBN(1002, 8))
    })

    it("first open Sqeeth and long future contracts", async () => {
      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(1, 8), scaledBN(1, 6)], depositOrWithdrawAmount })

      await checkGas(tx, 1897119)
    })

    it("open Sqeeth", async () => {
      await tradeWrapper.connect(other).openPositions({ vaultId, sizes: [1000, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)

      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(1, 8), 0], depositOrWithdrawAmount })

      const pool = await testContractSet.perpetualMarketCore.pools(sqeethPoolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.eq(80)

      await checkGas(tx, 264595)
    })

    it("open long future contracts", async () => {
      await tradeWrapper.connect(other).openPositions({ vaultId, sizes: [1000, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)

      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [0, scaledBN(1, 5)], depositOrWithdrawAmount })

      const pool = await testContractSet.perpetualMarketCore.pools(futurePoolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.eq(80)

      await checkGas(tx, 262150)
    })

    it("open Sqeeth and short future contracts", async () => {
      await tradeWrapper.connect(other).openPositions({ vaultId, sizes: [100, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)

      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(1, 8), scaledBN(-1, 6)], depositOrWithdrawAmount })

      await checkGas(tx, 385282)
    })

    it("open Sqeeth and short future contracts after price changed", async () => {
      await tradeWrapper.connect(other).openPositions({ vaultId, sizes: [100, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(1, 8), scaledBN(-1, 6)], depositOrWithdrawAmount })

      // The gas usage of opening Sqeeth and short future is less than 400k gas
      await checkGas(tx, 423120)
    })

    it("open Sqeeth and short future contracts crossing several fee levels after price changed", async () => {
      await tradeWrapper.connect(other).openPositions({ vaultId, sizes: [1000, size], depositOrWithdrawAmount })

      await increaseTime(60 * 60 * 2)
      await testContractHelper.updateSpot(scaledBN(1020, 8))

      const tx = await tradeWrapper.openPositions({ vaultId, sizes: [scaledBN(50, 8), scaledBN(-1, 6)], depositOrWithdrawAmount: scaledBN(500000, 6) })

      const pool = await testContractSet.perpetualMarketCore.pools(sqeethPoolId)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.gt(90)
      expect(pool.tradeState.currentFeeLevelIndex).to.be.lt(95)

      await checkGas(tx, 622562)
    })
  })
})