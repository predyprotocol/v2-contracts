import { expect } from 'chai'
import { ethers } from 'hardhat'
import { NettingLibTester } from '../typechain'
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
        await tester.getRequiredCollateral(0, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) }),
      ).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      expect(
        await tester.getRequiredCollateral(0, { gamma0: -2, delta0: -10, delta1: 0, spotPrice: scaledBN(1000, 8) }),
      ).to.be.eq('1134')
    })

    it('short future', async function () {
      expect(
        await tester.getRequiredCollateral(1, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) }),
      ).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      expect(
        await tester.getRequiredCollateral(0, { gamma0: -2, delta0: -10, delta1: 10, spotPrice: scaledBN(1000, 8) }),
      ).to.be.eq('1120')
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
      await tester.addCollateral(0, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(0)).usdcPosition).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(0, { gamma0: -2, delta0: -10, delta1: 0, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(0)).usdcPosition).to.be.eq('1134')
    })

    it('short future', async function () {
      await tester.addCollateral(1, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(1)).usdcPosition).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(0, { gamma0: -2, delta0: -10, delta1: 10, spotPrice: scaledBN(1000, 8) })
      expect((await tester.getPoolInfo(0)).usdcPosition).to.be.eq('1120')
    })
  })

  describe('complete', () => {
    it('reverts if there are no positions', async function () {
      await tester.addCollateral(0, { gamma0: 0, delta0: 0, delta1: 0, spotPrice: scaledBN(1000, 8) })

      await expect(
        tester.complete({ usdcAmount: 0, underlyingAmount: 0, deltas: [0, 0], spotPrice: scaledBN(1000, 8) }),
      ).to.be.revertedWith('N2')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(0, { gamma0: -2, delta0: -10, delta1: 0, spotPrice: scaledBN(1000, 8) })

      await tester.complete({ usdcAmount: 10000, underlyingAmount: 10, deltas: [-10, 0], spotPrice: scaledBN(1000, 8) })

      expect((await tester.info()).underlyingPosition).to.be.eq('10')

      const poolInfo0 = await tester.getPoolInfo(0)

      expect(poolInfo0.underlyingPosition).to.be.eq('10')
      expect(poolInfo0.usdcPosition).to.be.eq('11134')
      expect(poolInfo0.entry).to.be.eq('0')
    })

    it('short future', async function () {
      await tester.addCollateral(0, { gamma0: 0, delta0: 0, delta1: -10, spotPrice: scaledBN(1000, 8) })

      await tester.complete({ usdcAmount: 10000, underlyingAmount: 10, deltas: [0, -10], spotPrice: scaledBN(1000, 8) })

      expect((await tester.info()).underlyingPosition).to.be.eq('10')

      const poolInfo0 = await tester.getPoolInfo(1)

      expect(poolInfo0.underlyingPosition).to.be.eq('10')
      expect(poolInfo0.usdcPosition).to.be.eq('10000')
      expect(poolInfo0.entry).to.be.eq('0')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(0, { gamma0: -2, delta0: -10, delta1: 5, spotPrice: scaledBN(1000, 8) })

      await tester.complete({ usdcAmount: 5000, underlyingAmount: 5, deltas: [-10, 5], spotPrice: scaledBN(1000, 8) })

      expect((await tester.info()).underlyingPosition).to.be.eq('5')

      const poolInfo0 = await tester.getPoolInfo(0)

      expect(poolInfo0.underlyingPosition).to.be.eq('10')
      expect(poolInfo0.usdcPosition).to.be.eq('4457')
      expect(poolInfo0.entry).to.be.eq('6667')
    })
  })
})
