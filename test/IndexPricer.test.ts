import { expect } from 'chai'
import { ethers } from 'hardhat'
import { PricerTester } from '../typechain'
import { scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, SQEETH_PRODUCT_ID } from './utils/constants'

describe('IndexPricer', function () {
  let tester: PricerTester

  beforeEach(async () => {
    const PricerTester = await ethers.getContractFactory('PricerTester')

    tester = (await PricerTester.deploy()) as PricerTester
  })

  describe('calculatePrice', () => {
    describe('productId is 0', () => {
      const productId = SQEETH_PRODUCT_ID

      it('calculate price when spot is $2,000', async function () {
        const price = await tester.testCalculatePrice(productId, scaledBN(2000, 8))

        expect(price).to.equal(scaledBN(400, 8))
      })

      it('calculate price when spot is $3,000', async function () {
        const price = await tester.testCalculatePrice(productId, scaledBN(3000, 8))

        expect(price).to.equal(scaledBN(900, 8))
      })

      it('calculate price when spot is $4,000', async function () {
        const price = await tester.testCalculatePrice(productId, scaledBN(4000, 8))

        expect(price).to.equal(scaledBN(1600, 8))
      })

      it('calculate price when spot is $10,000', async function () {
        const price = await tester.testCalculatePrice(productId, scaledBN(10000, 8))

        expect(price).to.equal(scaledBN(10000, 8))
      })
    })

    describe('productId is 1', () => {
      const productId = FUTURE_PRODUCT_ID

      it('calculate price when spot is $1,000', async function () {
        const price = await tester.testCalculatePrice(productId, scaledBN(1000, 8))

        expect(price).to.equal(scaledBN(1000, 8))
      })
    })
  })

  describe('calculateDelta', () => {
    describe('productId is 0', () => {
      const productId = SQEETH_PRODUCT_ID

      it('calculate delta when spot is $2,000', async function () {
        const delta = await tester.testCalculateDelta(productId, scaledBN(2000, 8))

        expect(delta).to.equal(scaledBN(4, 7))
      })

      it('calculate delta when spot is $3,000', async function () {
        const delta = await tester.testCalculateDelta(productId, scaledBN(3000, 8))

        expect(delta).to.equal(scaledBN(6, 7))
      })

      it('calculate delta when spot is $4,000', async function () {
        const delta = await tester.testCalculateDelta(productId, scaledBN(4000, 8))

        expect(delta).to.equal(scaledBN(8, 7))
      })

      it('calculate delta when spot is $10,000', async function () {
        const delta = await tester.testCalculateDelta(productId, scaledBN(10000, 8))

        expect(delta).to.equal(scaledBN(20, 7))
      })
    })

    describe('productId is 1', () => {
      const productId = FUTURE_PRODUCT_ID

      it('calculate delta when spot is $1,000', async function () {
        const delta = await tester.testCalculateDelta(productId, scaledBN(1000, 8))

        expect(delta).to.equal(scaledBN(1, 8))
      })
    })
  })
})
