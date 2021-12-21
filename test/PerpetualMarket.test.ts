import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20, PerpetualMarket, TradeWrapper } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { scaledBN } from "./utils/helpers";

describe("PerpetualMarket", function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20
  let perpetualMarket: PerpetualMarket

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)

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

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))

    await usdc.approve(testContractSet.perpetualMarket.address, MaxInt128)
    await usdc.approve(testContractSet.tradeWrapper.address, MaxInt128)
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe("deposit", () => {
    const poolId = 0
    const vaultId = 0

    it("deposit 1 usdc", async () => {
      await testContractSet.perpetualMarket.deposit(poolId, scaledBN(1, 6), 100, 110)
    })

    it("deposit into lower", async () => {
      await testContractSet.perpetualMarket.deposit(poolId, scaledBN(5, 6), 10, 60)

      await testContractHelper.openLong(wallet, vaultId, scaledBN(18, 5), scaledBN(100, 6))

      const pool = await testContractSet.perpetualMarket.pools(poolId)
      expect(pool.tradeState.currentFeeLevel).to.be.gt(scaledBN(50, 6))

      await testContractSet.perpetualMarket.deposit(poolId, scaledBN(1, 6), 10, 12)
    })

    describe("deposit after unrealized PnL changed", () => {
      const amount = scaledBN(1, 6)
      const feeLevelLower = 50
      const feeLevelUpper = 60

      beforeEach(async () => {
        await testContractSet.perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, 20000, scaledBN(1, 6))
      })

      it("deposit after unrealized PnL becomes larger", async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))

        const pool1 = await testContractSet.perpetualMarket.pools(poolId)
        console.log('fee level', pool1.tradeState.currentFeeLevel.toString())

        await testContractHelper.openShort(wallet, vaultId, 10000, 0)

        const pool2 = await testContractSet.perpetualMarket.pools(poolId)
        console.log('fee level', pool2.tradeState.currentFeeLevel.toString())

        const beforeUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)
        const poolBefore = await testContractSet.perpetualMarket.pools(poolId)

        await testContractSet.perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        const afterUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)
        const poolAfter = await testContractSet.perpetualMarket.pools(poolId)

        console.log(beforeUnrealizedPnL.toString())


        // expect(poolBefore.tradeState.liquidityBefore).to.be.lt(poolAfter.tradeState.liquidityBefore)

        expect(beforeUnrealizedPnL).to.be.eq(afterUnrealizedPnL)
      })

      it("deposit after unrealized PnL becomes smaller", async () => {
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, 10000, 0)

        const beforeUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)

        await testContractSet.perpetualMarket.deposit(poolId, amount, feeLevelLower, feeLevelUpper)

        const afterUnrealizedPnL = await testContractSet.perpetualMarket.getUnrealizedPnLPerLiquidity(poolId)

        expect(beforeUnrealizedPnL).to.be.eq(afterUnrealizedPnL)
      })
    })
  })
})
