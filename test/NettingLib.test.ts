import { expect } from 'chai'
import { ethers } from 'hardhat'
import { NettingLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('NettingLib', function () {
  let tester: NettingLibTester

  beforeEach(async () => {
    const NettingLibTester = await ethers.getContractFactory('NettingLibTester')

    tester = (await NettingLibTester.deploy()) as NettingLibTester
  })

  describe('getRequiredCollateral', () => {
    it('no positions', async function () {
      expect(
        await tester.getRequiredCollateral(SQEETH_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
        }),
      ).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      expect(
        await tester.getRequiredCollateral(SQEETH_PRODUCT_ID, {
          gamma0: -2,
          delta0: -2000,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
        }),
      ).to.be.eq('3920000')
    })

    it('short future', async function () {
      expect(
        await tester.getRequiredCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        }),
      ).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      expect(
        await tester.getRequiredCollateral(SQEETH_PRODUCT_ID, {
          gamma0: -2,
          delta0: -2000,
          delta1: 2000,
          spotPrice: scaledBN(1000, 8),
        }),
      ).to.be.eq('1120000')
    })
  })

  describe('calculateWeightedDelta', () => {
    it('no positions', async function () {
      expect(await tester.calculateWeightedDelta(0, 0, 0)).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      expect(await tester.calculateWeightedDelta(0, -10, 0)).to.be.eq('-10')
    })

    it('short future', async function () {
      expect(await tester.calculateWeightedDelta(1, 0, -10)).to.be.eq('-10')
    })
  })

  describe('addCollateral', () => {
    it('no positions', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
      })
      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1134000')
    })

    it('short future', async function () {
      await tester.addCollateral(FUTURE_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getInfo()).amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 10,
        spotPrice: scaledBN(1000, 8),
      })

      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1120000')
    })

    describe('long future', () => {
      beforeEach(async () => {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          amountUsdc: 100000,
          amountUnderlying: 100,
          deltas: [0, -100],
          isLong: true,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })
    })
  })

  describe('complete', () => {
    it('reverts if there are no positions', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) })

      await expect(
        tester.complete({
          amountUsdc: 0,
          amountUnderlying: 0,
          deltas: [0, 0],
          isLong: true,
        }),
      ).to.be.revertedWith('N2')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
      })

      await tester.complete({
        amountUsdc: 10000,
        amountUnderlying: 10,
        deltas: [-10, 0],
        isLong: true,
      })

      const info = await tester.getInfo()

      expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('10')
      expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1124000')
    })

    describe('short future', () => {
      it('underlying price not changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          amountUsdc: 10000,
          amountUnderlying: 10,
          deltas: [0, -10],
          isLong: true,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('10')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('4000')
      })

      it('underlying price changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          amountUsdc: 11000,
          amountUnderlying: 10,
          deltas: [0, -10],
          isLong: true,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('10')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('3000')
      })

      it('underlying price changed and there is slippage', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          amountUsdc: 11100,
          amountUnderlying: 10,
          deltas: [0, -10],
          isLong: true,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('10')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('2900')
      })
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -100,
        delta1: 50,
        spotPrice: scaledBN(1000, 8),
      })

      await tester.addCollateral(FUTURE_PRODUCT_ID, {
        gamma0: -2,
        delta0: -100,
        delta1: 50,
        spotPrice: scaledBN(1000, 8),
      })

      await tester.complete({
        amountUsdc: 50000,
        amountUnderlying: 50,
        deltas: [-100, 50],
        isLong: true,
      })

      const info = await tester.getInfo()

      expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
      expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1132867')
      expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('-50')
      expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('5734')
    })

    describe('long future', () => {
      beforeEach(async () => {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          amountUsdc: 100000,
          amountUnderlying: 100,
          deltas: [0, -100],
          isLong: true,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('there is no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const info0 = await tester.getInfo()

        expect(info0.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')

        await tester.complete({
          amountUsdc: 50000,
          amountUnderlying: 50,
          deltas: [0, -50],
          isLong: false,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('50')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('50000')
      })

      it('underlying price not changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const info0 = await tester.getInfo()

        expect(info0.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 20000,
          amountUnderlying: 20,
          deltas: [0, -80],
          isLong: false,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('80')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('32000')
      })

      it('underlying price changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const info0 = await tester.getInfo()

        expect(info0.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 22000,
          amountUnderlying: 20,
          deltas: [0, -80],
          isLong: false,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('80')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('34000')
      })

      it('underlying price changed and there is slippage', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const beforeInfo = await tester.getInfo()

        expect(beforeInfo.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 21800,
          amountUnderlying: 20,
          deltas: [0, -80],
          isLong: false,
        })

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('80')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('33800')
      })
    })
  })
})
