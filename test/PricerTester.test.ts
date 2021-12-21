import { expect } from "chai";
import { ethers } from "hardhat";
import { PricerTester } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import { scaledBN } from "./utils/helpers";

describe("PricerTester", function () {
  let wallet: Wallet, other: Wallet
  let tester: PricerTester

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
  })

  beforeEach(async () => {
    const PricerTester = await ethers.getContractFactory('PricerTester')

    tester = (await PricerTester.deploy()) as PricerTester
  })

  describe("calculatePrice", () => {
    describe("poolId is 0", () => {
      const poolId = 0

      it("calculate price when spot is $2,000", async function () {
        const price = await tester.testCalculatePrice(poolId, scaledBN(2000, 8))

        expect(price).to.equal(scaledBN(400, 8));
      })

      it("calculate price when spot is $3,000", async function () {
        const price = await tester.testCalculatePrice(poolId, scaledBN(3000, 8))

        expect(price).to.equal(scaledBN(900, 8));
      })

      it("calculate price when spot is $4,000", async function () {
        const price = await tester.testCalculatePrice(poolId, scaledBN(4000, 8))

        expect(price).to.equal(scaledBN(1600, 8));
      })

      it("calculate price when spot is $10,000", async function () {
        const price = await tester.testCalculatePrice(poolId, scaledBN(10000, 8))

        expect(price).to.equal(scaledBN(10000, 8));
      })
    })

    describe("poolId is 1", () => {
      const poolId = 1

      it("calculate price when spot is $1,000", async function () {
        const price = await tester.testCalculatePrice(poolId, scaledBN(1000, 8))

        expect(price).to.equal(scaledBN(1000, 8));
      })
    })
  })

  describe("calculateDelta", () => {
    describe("poolId is 0", () => {
      const poolId = 0

      it("calculate delta when spot is $2,000", async function () {
        const delta = await tester.testCalculateDelta(poolId, scaledBN(2000, 8))

        expect(delta).to.equal(scaledBN(4, 7));
      })

      it("calculate delta when spot is $3,000", async function () {
        const delta = await tester.testCalculateDelta(poolId, scaledBN(3000, 8))

        expect(delta).to.equal(scaledBN(6, 7));
      })

      it("calculate delta when spot is $4,000", async function () {
        const delta = await tester.testCalculateDelta(poolId, scaledBN(4000, 8))

        expect(delta).to.equal(scaledBN(8, 7));
      })

      it("calculate delta when spot is $10,000", async function () {
        const delta = await tester.testCalculateDelta(poolId, scaledBN(10000, 8))

        expect(delta).to.equal(scaledBN(20, 7));
      })
    })

    describe("poolId is 1", () => {
      const poolId = 1

      it("calculate delta when spot is $1,000", async function () {
        const delta = await tester.testCalculateDelta(poolId, scaledBN(1000, 8))

        expect(delta).to.equal(scaledBN(1, 8));
      })
    })
  })
})
