import { expect } from "chai";
import { ethers } from "hardhat";
import { HedgingTester } from '../typechain'
import { scaledBN } from "./utils/helpers";

describe("Hedging", function () {
  let tester: HedgingTester

  beforeEach(async () => {
    const Hedging = await ethers.getContractFactory('Hedging')
    const hedging = (await Hedging.deploy())

    const HedgingTester = await ethers.getContractFactory('HedgingTester', {
      libraries: {
        Hedging: hedging.address
      }
    })

    tester = (await HedgingTester.deploy()) as HedgingTester
  })

  describe("addPosition", () => {
    const poolId = 1

    it("add long position", async function () {
      const newDelta = scaledBN(-1, 6)
      const requiredCollateral = scaledBN(10, 6)
      const spot = scaledBN(2000, 8)

      await tester.testAddPosition(poolId, newDelta, requiredCollateral, spot)

      const entry = await tester.getEntry(poolId, spot)
      expect(entry).to.be.eq('2000000000')
    })

    it("add short position", async function () {
      const newDelta = scaledBN(1, 6)
      const requiredCollateral = scaledBN(10, 6)
      const spot = scaledBN(2000, 8)

      await tester.testAddPosition(poolId, newDelta, requiredCollateral, spot)

      const entry = await tester.getEntry(poolId, spot)

      expect(entry).to.be.eq('-2000000000')
    })

    it("add long and short position", async function () {
      const requiredCollateral = scaledBN(10, 6)
      const spot = scaledBN(2000, 8)

      await tester.testAddPosition(poolId, scaledBN(-10, 5), requiredCollateral, spot)
      await tester.testAddPosition(poolId, scaledBN(-5, 5), requiredCollateral, spot)

      const entry = await tester.getEntry(poolId, spot)

      expect(entry).to.be.eq('1000000000')
    })

    it("spot price is changed", async function () {
      const requiredCollateral = scaledBN(10, 6)

      await tester.testAddPosition(poolId, scaledBN(-10, 5), requiredCollateral, scaledBN(2000, 8))

      const entry = await tester.getEntry(poolId, scaledBN(2010, 8))

      expect(entry).to.be.eq('2010000000')
    })
  })

  describe("complete", () => {
    const poolId = 1

    describe("long", () => {
      const newDelta = scaledBN(-1, 6)

      it("loss is 0", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(2000, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('2000000000')
      })

      it("has loss", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(2010, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('2010000000')
      })

      it("has profit", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(1990, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('1990000000')
      })

      it("spot price is changed after hedging", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, scaledBN(-10, 5), requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(1990, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2010, 8))

        expect(entry).to.be.eq('1990000000')
      })
    })

    describe("short", () => {
      const newDelta = scaledBN(1, 6)

      it("loss is 0", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(2000, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('-2000000000')
      })

      it("has loss", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(1990, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('-1990000000')
      })

      it("has profit", async function () {
        const requiredCollateral = scaledBN(10, 6)
        const underlyingPositionDelta = newDelta.mul(-1)

        await tester.testAddPosition(poolId, newDelta, requiredCollateral, scaledBN(2000, 8))

        await tester.testComplete(underlyingPositionDelta, scaledBN(2010, 8))

        const entry = await tester.getEntry(poolId, scaledBN(2000, 8))
        expect(entry).to.be.eq('-2010000000')
      })
    })
  })
})
