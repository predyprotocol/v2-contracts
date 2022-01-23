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
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).usdcPosition).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
      })
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).usdcPosition).to.be.eq('1134000')
    })

    it('short future', async function () {
      await tester.addCollateral(FUTURE_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(FUTURE_PRODUCT_ID)).usdcPosition).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 10,
        spotPrice: scaledBN(1000, 8),
      })
      expect((await tester.getPoolInfo(SQEETH_PRODUCT_ID)).usdcPosition).to.be.eq('1120000')
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
          usdcAmount: 100000,
          underlyingAmount: 100,
          deltas: [0, -100],
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('100')
        expect(poolInfo.usdcPosition).to.be.eq('40000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.usdcPosition).to.be.eq('0')
      })
    })
  })

  describe('complete', () => {
    it('reverts if there are no positions', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) })

      await expect(
        tester.complete({
          usdcAmount: 0,
          underlyingAmount: 0,
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
        usdcAmount: 10000,
        underlyingAmount: 10,
        deltas: [-10, 0],
        spotPrice: scaledBN(1000, 8),
        isLong: true,
      })

      expect((await tester.info()).underlyingPosition).to.be.eq('10')

      const poolInfo0 = await tester.getPoolInfo(SQEETH_PRODUCT_ID)

      expect(poolInfo0.underlyingPosition).to.be.eq('10')
      expect(poolInfo0.usdcPosition).to.be.eq('1124000')
      expect(poolInfo0.entry).to.be.eq('0')
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
          usdcAmount: 10000,
          underlyingAmount: 10,
          deltas: [0, -10],
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('10')
        expect(poolInfo.usdcPosition).to.be.eq('4000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('underlying price changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          usdcAmount: 11000,
          underlyingAmount: 10,
          deltas: [0, -10],
          spotPrice: scaledBN(1100, 8),
          isLong: true,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('10')
        expect(poolInfo.usdcPosition).to.be.eq('3000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('underlying price changed and there is slippage', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -10,
          spotPrice: scaledBN(1000, 8),
        })

        await tester.complete({
          usdcAmount: 11100,
          underlyingAmount: 10,
          deltas: [0, -10],
          spotPrice: scaledBN(1100, 8),
          isLong: true,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('10')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('10')
        expect(poolInfo.usdcPosition).to.be.eq('2900')
        expect(poolInfo.entry).to.be.eq('-100')
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
        usdcAmount: 5000,
        underlyingAmount: 5,
        deltas: [-10, 5],
        spotPrice: scaledBN(1000, 8),
        isLong: true,
      })

      expect((await tester.info()).underlyingPosition).to.be.eq('5')

      const poolInfo0 = await tester.getPoolInfo(SQEETH_PRODUCT_ID)

      expect(poolInfo0.underlyingPosition).to.be.eq('10')
      expect(poolInfo0.usdcPosition).to.be.eq('1120867')
      expect(poolInfo0.entry).to.be.eq('6667')
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
          usdcAmount: 100000,
          underlyingAmount: 100,
          deltas: [0, -100],
          spotPrice: scaledBN(1000, 8),
          isLong: true,
        })

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('100')
        expect(poolInfo.usdcPosition).to.be.eq('40000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('there is no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.usdcPosition).to.be.eq('0')

        await tester.complete({
          usdcAmount: 50000,
          underlyingAmount: 50,
          deltas: [0, -50],
          spotPrice: scaledBN(1000, 8),
          isLong: false,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('50')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('50')
        expect(poolInfo.usdcPosition).to.be.eq('50000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('underlying price not changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.usdcPosition).to.be.eq('12000')

        await tester.complete({
          usdcAmount: 20000,
          underlyingAmount: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1000, 8),
          isLong: false,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('80')
        expect(poolInfo.usdcPosition).to.be.eq('32000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('underlying price changed', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.usdcPosition).to.be.eq('12000')

        await tester.complete({
          usdcAmount: 22000,
          underlyingAmount: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1100, 8),
          isLong: false,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('80')
        expect(poolInfo.usdcPosition).to.be.eq('34000')
        expect(poolInfo.entry).to.be.eq('0')
      })

      it('underlying price changed and there is slippage', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -80,
          spotPrice: scaledBN(1000, 8),
        })

        const poolInfo0 = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo0.usdcPosition).to.be.eq('12000')

        await tester.complete({
          usdcAmount: 21800,
          underlyingAmount: 20,
          deltas: [0, -80],
          spotPrice: scaledBN(1100, 8),
          isLong: false,
        })

        expect((await tester.info()).underlyingPosition).to.be.eq('80')

        const poolInfo = await tester.getPoolInfo(FUTURE_PRODUCT_ID)

        expect(poolInfo.underlyingPosition).to.be.eq('80')
        expect(poolInfo.usdcPosition).to.be.eq('33800')
        expect(poolInfo.entry).to.be.eq('800')
      })
    })
  })
})
