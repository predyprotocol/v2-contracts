import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { TradeStateLibTester } from '../typechain'
import { scaledBN } from "./utils/helpers";

describe("TradeStateLib", function () {
  let tester: TradeStateLibTester

  beforeEach(async () => {
    const TradeStateLibTester = await ethers.getContractFactory('TradeStateLibTester')

    tester = (await TradeStateLibTester.deploy()) as TradeStateLibTester
  })

  describe("calculateNotionalLockedAndUnlockedLiquidity", () => {
    const feeLevelMultipliedLiquidityGlobal = BigNumber.from(0)
    const realizedPnLGlobal = 0

    it("the range is higher than current level", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 0, liquidityBefore: 0, lockedLiquidity: 0, currentFeeLevelIndex: 10, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 10, 20, 30, 100)
      expect(result[0]).to.be.eq(0)
      expect(result[1]).to.be.eq(100)
    })

    it("the range is lower than current level", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 0, liquidityBefore: 0, lockedLiquidity: 0, currentFeeLevelIndex: 10, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 50, 20, 30, 100)
      expect(result[0]).to.be.eq(100)
      expect(result[1]).to.be.eq(0)
    })

    it("1. the range is in current level and half liquidity is locked in the current", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 10, liquidityBefore: 55, lockedLiquidity: 5, currentFeeLevelIndex: 25, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 25, 20, 30, 100)
      expect(result[0]).to.be.eq(55)
      expect(result[1]).to.be.eq(45)
    })

    it("2. the range is in current level and half liquidity is locked in the current", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 20, liquidityBefore: 110, lockedLiquidity: 10, currentFeeLevelIndex: 25, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 25, 20, 30, 100)
      expect(result[0]).to.be.eq(55)
      expect(result[1]).to.be.eq(45)
    })

    it("the range is in current level and there is no locked liquidity in the current", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 20, liquidityBefore: 100, lockedLiquidity: 0, currentFeeLevelIndex: 25, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 25, 20, 30, 100)
      expect(result[0]).to.be.eq(50)
      expect(result[1]).to.be.eq(50)
    })

    it("test", async function () {
      const result = await tester.testCalculateNotionalLockedAndUnlockedLiquidity({ liquidityDelta: 10, liquidityBefore: 2, lockedLiquidity: 2, currentFeeLevelIndex: 0, feeLevelMultipliedLiquidityGlobal, realizedPnLGlobal }, 20, 20, 30, 100)
      expect(result[0]).to.be.eq(2)
      expect(result[1]).to.be.eq(98)
    })
  })
})
