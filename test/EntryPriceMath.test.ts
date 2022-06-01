import { expect } from 'chai'
import { ethers } from 'hardhat'
import { EntryPriceMathTester } from '../typechain'

describe('EntryPriceMath', function () {
  let tester: EntryPriceMathTester

  beforeEach(async () => {
    const EntryPriceMathTester = await ethers.getContractFactory('EntryPriceMathTester')

    tester = (await EntryPriceMathTester.deploy()) as EntryPriceMathTester
  })

  describe('updateEntryPrice', () => {
    describe('no positions', () => {
      it('add long position', async function () {
        const result = await tester.verifyUpdateEntryPrice(0, 0, 100, '100000000')
        expect(result[0]).to.be.eq('100')
        expect(result[1]).to.be.eq('0')
      })

      it('add short position', async function () {
        const result = await tester.verifyUpdateEntryPrice(0, 0, 100, '-100000000')
        expect(result[0]).to.be.eq('100')
        expect(result[1]).to.be.eq('0')
      })
    })

    describe('tradePrice not changed', () => {
      const tradePrice = 100

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position and positions becomes negative', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-600000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '600000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('0')
        })
      })
    })

    describe('tradePrice becomes high', () => {
      const tradePrice = 110

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('101')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('10')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('50')
        })

        it('add short position and positions becomes negative', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-600000000')
          expect(result[0]).to.be.eq('110')
          expect(result[1]).to.be.eq('50')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('101')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('-10')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('-50')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '600000000')
          expect(result[0]).to.be.eq('110')
          expect(result[1]).to.be.eq('-50')
        })
      })
    })

    describe('tradePrice becomes low', () => {
      const tradePrice = 90

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('98')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-100000000')

          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('-10')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('-50')
        })

        it('add short position and positions becomes negatve', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '500000000', tradePrice, '-600000000')

          expect(result[0]).to.be.eq('90')
          expect(result[1]).to.be.eq('-50')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '-100000000')

          expect(result[0]).to.be.eq('98')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '100000000')

          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('10')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '500000000')

          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('50')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(100, '-500000000', tradePrice, '600000000')

          expect(result[0]).to.be.eq('90')
          expect(result[1]).to.be.eq('50')
        })
      })
    })

    describe('tradePrice and entryPrice are same and values are negative', () => {
      const tradePrice = -100

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position and positions becomes negative', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-600000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '600000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('0')
        })
      })
    })

    describe('tradePrice is positive and entryPrice is negative', () => {
      const tradePrice = 100

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('-66')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('200')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('1000')
        })

        it('add short position and positions becomes negative', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '500000000', tradePrice, '-600000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('1000')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('-66')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('-200')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('-1000')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(-100, '-500000000', tradePrice, '600000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('-1000')
        })
      })
    })

    describe('tradePrice is negative and entryPrice is positive', () => {
      const tradePrice = -100
      const entryPrice = 100

      describe('there are long positions', () => {
        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('66')
          expect(result[1]).to.be.eq('0')
        })

        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('-200')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '500000000', tradePrice, '-500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('-1000')
        })

        it('add short position and positions becomes negative', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '500000000', tradePrice, '-600000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('-1000')
        })
      })

      describe('there are short positions', () => {
        it('add short position', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '-500000000', tradePrice, '-100000000')
          expect(result[0]).to.be.eq('66')
          expect(result[1]).to.be.eq('0')
        })

        it('add long position', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '-500000000', tradePrice, '100000000')
          expect(result[0]).to.be.eq('100')
          expect(result[1]).to.be.eq('200')
        })

        it('close all positions', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '-500000000', tradePrice, '500000000')
          expect(result[0]).to.be.eq('0')
          expect(result[1]).to.be.eq('1000')
        })

        it('add long position and positions becomes positive', async function () {
          const result = await tester.verifyUpdateEntryPrice(entryPrice, '-500000000', tradePrice, '600000000')
          expect(result[0]).to.be.eq('-100')
          expect(result[1]).to.be.eq('1000')
        })
      })
    })
  })
})
