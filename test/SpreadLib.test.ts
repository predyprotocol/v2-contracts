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
        it('maxShortTradePrice is 8000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 8000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 8000,
              },
              true,
              10000,
              1200,
            ),
          ).to.be.eq('10000')
        })

        it('maxShortTradePrice is 12000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
              },
              true,
              10000,
              1200,
            ),
          ).to.be.eq('10000')
        })
      })

      describe('before safety period', () => {
        it('maxShortTradePrice is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 8000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 8000,
              },
              true,
              10000,
              601,
            ),
          ).to.be.eq('10000')
        })

        it('maxShortTradePrice is 12000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
              },
              true,
              10000,
              601,
            ),
          ).to.be.eq('12000')
        })
      })
    })

    describe('short', () => {
      describe('after safety period', () => {
        it('minLongTradePrice is 8000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 8000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 8000,
              },
              false,
              10000,
              1200,
            ),
          ).to.be.eq('10000')
        })

        it('minLongTradePrice is 12000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
              },
              false,
              10000,
              1200,
            ),
          ).to.be.eq('10000')
        })
      })

      describe('before safety period', () => {
        it('minLongTradePrice is 8000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 8000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 8000,
              },
              false,
              10000,
              601,
            ),
          ).to.be.eq('8000')
        })

        it('minLongTradePrice is 12000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
              },
              false,
              10000,
              601,
            ),
          ).to.be.eq('10000')
        })
      })
    })
  })
})
