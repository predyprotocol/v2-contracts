import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SpreadLibTester } from '../typechain'
import { NUM_BLOCKS_PER_SPREAD_DECREASING, SAFETY_BLOCK_PERIOD } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('SpreadLib', function () {
  let tester: SpreadLibTester

  beforeEach(async () => {
    const SpreadLibTester = await ethers.getContractFactory('SpreadLibTester')

    tester = (await SpreadLibTester.deploy()) as SpreadLibTester

    await tester.init()
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
              },
              true,
              10000,
              601,
            ),
          ).to.be.eq('12000')
        })

        it('spread closes', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
              },
              true,
              10000,
              610,
            ),
          ).to.be.eq('11996')
        })

        it('spread closes over blocks', async function () {
          // long 100000
          await tester.updatePrice(true, scaledBN(1000, 8), 600)

          // long 101000
          await tester.updatePrice(true, scaledBN(1004, 8), 612)

          // long 102000
          await tester.updatePrice(true, scaledBN(1008, 8), 624)
          await tester.updatePrice(false, scaledBN(1012, 8), 636)

          // long 103000
          expect(await tester.getUpdatedPrice(await tester.info(), true, scaledBN(1012, 8), 636)).to.be.eq(
            '101200000000',
          )

          // short 103000
          expect(await tester.getUpdatedPrice(await tester.info(), false, scaledBN(1012, 8), 636)).to.be.eq(
            '100080016000',
          )

          // long 103000
          expect(await tester.getUpdatedPrice(await tester.info(), true, scaledBN(1012, 8), 648)).to.be.eq(
            '101200000000',
          )

          // short 103000
          expect(await tester.getUpdatedPrice(await tester.info(), false, scaledBN(1012, 8), 648)).to.be.eq(
            '101200000000',
          )
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
              },
              false,
              10000,
              601,
            ),
          ).to.be.eq('8000')
        })

        it('spread closes', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 8000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 8000,
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
              },
              false,
              10000,
              610,
            ),
          ).to.be.eq('8002')
        })

        it('minLongTradePrice is 12000', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                blockLastLongTransaction: 600,
                minLongTradePrice: 12000,
                blockLastShortTransaction: 600,
                maxShortTradePrice: 12000,
                safetyBlockPeriod: SAFETY_BLOCK_PERIOD,
                numBlocksPerSpreadDecreasing: NUM_BLOCKS_PER_SPREAD_DECREASING,
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
