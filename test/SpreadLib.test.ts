import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SpreadLibTester } from '../typechain'

describe('SpreadLib', function () {
  let tester: SpreadLibTester

  beforeEach(async () => {
    const SpreadLibTester = await ethers.getContractFactory('SpreadLibTester')

    tester = (await SpreadLibTester.deploy()) as SpreadLibTester
  })

  describe('getUpdatedPrice', () => {
    describe('long', () => {
      describe('after safety period', () => {
        it('maxShortTradePrice is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 80,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 80,
              },
              true,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })

        it('maxShortTradePrice is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 120,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 120,
              },
              true,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })
      })

      describe('before safety period', () => {
        it('maxShortTradePrice is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 80,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 80,
              },
              true,
              100,
              601,
            ),
          ).to.be.eq('100')
        })

        it('maxShortTradePrice is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 120,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 120,
              },
              true,
              100,
              601,
            ),
          ).to.be.eq('119')
        })
      })
    })

    describe('short', () => {
      describe('after safety period', () => {
        it('minLongTradePrice is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 80,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 80,
              },
              false,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })

        it('minLongTradePrice is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 120,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 120,
              },
              false,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })
      })

      describe('before safety period', () => {
        it('minLongTradePrice is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 80,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 80,
              },
              false,
              100,
              601,
            ),
          ).to.be.eq('80')
        })

        it('minLongTradePrice is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 120,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 120,
              },
              false,
              100,
              601,
            ),
          ).to.be.eq('100')
        })
      })
    })
  })
})
