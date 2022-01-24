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
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).amountUsdc).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
      })
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).amountUsdc).to.be.eq('1134000')
    })

    it('short future', async function () {
      await tester.addCollateral(FUTURE_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(FUTURE_PRODUCT_ID)).amountUsdc).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 10,
        spotPrice: scaledBN(1000, 8),
      })
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).amountUsdc).to.be.eq('1120000')
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
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('100')
        expect(poolInfo.amountUsdc).to.be.eq('40000')
        expect(poolInfo.valueEntry).to.be.eq('0')
      })

      it('no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.amountUsdc).to.be.eq('0')
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
          spotPrice: scaledBN(1000, 8),
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
        spotPrice: scaledBN(1000, 8),
        isLong: true,
      })

      expect((await tester.info()).amountUnderlying).to.be.eq('10')

      const poolInfo0 = await tester.getPoolInfo(SQEETH_PRODUCT_ID)

      expect(poolInfo0.amountUnderlying).to.be.eq('10')
      expect(poolInfo0.amountUsdc).to.be.eq('1124000')
      expect(poolInfo0.valueEntry).to.be.eq('0')
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
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('10')
        expect(poolInfo.amountUsdc).to.be.eq('4000')
        expect(poolInfo.valueEntry).to.be.eq('0')
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
          spotPrice: scaledBN(1100, 8),
          isLong: true,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('10')
        expect(poolInfo.amountUsdc).to.be.eq('3000')
        expect(poolInfo.valueEntry).to.be.eq('0')
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
          spotPrice: scaledBN(1100, 8),
          isLong: true,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('10')
        expect(poolInfo.amountUsdc).to.be.eq('2900')
        expect(poolInfo.valueEntry).to.be.eq('-100')
      })
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 5,
        spotPrice: scaledBN(1000, 8),
      })

      await tester.complete({
        amountUsdc: 5000,
        amountUnderlying: 5,
        deltas: [-10, 5],
        spotPrice: scaledBN(1000, 8),
        isLong: true,
      })

      expect((await tester.info()).amountUnderlying).to.be.eq('5')

      const poolInfo0 = await tester.getPoolInfo(SQEETH_PRODUCT_ID)

      expect(poolInfo0.amountUnderlying).to.be.eq('10')
      expect(poolInfo0.amountUsdc).to.be.eq('1120867')
      expect(poolInfo0.valueEntry).to.be.eq('6667')
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
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('100')
        expect(poolInfo.amountUsdc).to.be.eq('40000')
        expect(poolInfo.valueEntry).to.be.eq('0')
      })

      it('there is no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.amountUsdc).to.be.eq('0')

        await tester.complete({
          amountUsdc: 50000,
          amountUnderlying: 50,
          deltas: [0, -50],
          spotPrice: scaledBN(1000, 8),
          isLong: false,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('50')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('50')
        expect(poolInfo.amountUsdc).to.be.eq('50000')
        expect(poolInfo.valueEntry).to.be.eq('0')
      })

      it('underlying price not changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.amountUsdc).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 20000,
          amountUnderlying: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1000, 8),
          isLong: false,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('80')
        expect(poolInfo.amountUsdc).to.be.eq('32000')
        expect(poolInfo.valueEntry).to.be.eq('0')
      })

      it('underlying price changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.amountUsdc).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 22000,
          amountUnderlying: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1100, 8),
          isLong: false,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('80')
        expect(poolInfo.amountUsdc).to.be.eq('34000')
        expect(poolInfo.valueEntry).to.be.eq('0')
      })

      it('underlying price changed and there is slippage', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.amountUsdc).to.be.eq('12000')

        await tester.complete({
          amountUsdc: 21800,
          amountUnderlying: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1100, 8),
          isLong: false,
        })

        expect((await tester.info()).amountUnderlying).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.amountUnderlying).to.be.eq('80')
        expect(poolInfo.amountUsdc).to.be.eq('33800')
        expect(poolInfo.valueEntry).to.be.eq('800')
      })
    })
  })
})
