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
        it('maxBit is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 80,
                bitTime: 600,
                maxBitPrice: 80,
              },
              true,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })

        it('maxBit is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 120,
                bitTime: 600,
                maxBitPrice: 120,
              },
              true,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })
      })

      describe('before safety period', () => {
        it('maxBit is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 80,
                bitTime: 600,
                maxBitPrice: 80,
              },
              true,
              100,
              660,
            ),
          ).to.be.eq('100')
        })

        it('maxBit is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 120,
                bitTime: 600,
                maxBitPrice: 120,
              },
              true,
              100,
              660,
            ),
          ).to.be.eq('119')
        })
      })
    })

    describe('short', () => {
      describe('after safety period', () => {
        it('minAsk is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 80,
                bitTime: 600,
                maxBitPrice: 80,
              },
              false,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })

        it('minAsk is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 120,
                bitTime: 600,
                maxBitPrice: 120,
              },
              false,
              100,
              1200,
            ),
          ).to.be.eq('100')
        })
      })

      describe('before safety period', () => {
        it('minAsk is 80', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 80,
                bitTime: 600,
                maxBitPrice: 80,
              },
              false,
              100,
              660,
            ),
          ).to.be.eq('80')
        })

        it('minAsk is 120', async function () {
          expect(
            await tester.getUpdatedPrice(
              {
                askTime: 600,
                minAskPrice: 120,
                bitTime: 600,
                maxBitPrice: 120,
              },
              false,
              100,
              660,
            ),
          ).to.be.eq('100')
        })
      })
    })
  })
})
