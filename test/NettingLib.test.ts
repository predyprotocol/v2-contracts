import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { NettingLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('NettingLib', function () {
  let tester: NettingLibTester

  const poolCollateralRiskParam = 4000

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
          poolCollateralRiskParam,
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
          poolCollateralRiskParam,
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
          poolCollateralRiskParam,
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
          poolCollateralRiskParam,
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
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: 0,
        delta0: 0,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolCollateralRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolCollateralRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1134000')
    })

    it('short future', async function () {
      await tester.addCollateral(FUTURE_PRODUCT_ID, {
        gamma0: 0,
        delta0: 0,
        delta1: -10,
        spotPrice: scaledBN(1000, 8),
        poolCollateralRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: -2,
        delta0: -10,
        delta1: 10,
        spotPrice: scaledBN(1000, 8),
        poolCollateralRiskParam,
      })

      expect((await tester.getInfo()).amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1120000')
    })

    describe('delta of perpetual future is negative', () => {
      beforeEach(async () => {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountsUnderlying,
          [0, -100],
          scaledBN(1000, 8),
        )

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('delta increases', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -90,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('26000')
      })

      it('delta increases but no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes 0', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes positive', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })
    })

    describe('deltas are negative', () => {
      beforeEach(async () => {
        await tester.addCollateral(SQEETH_PRODUCT_ID, {
          gamma0: 0,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountsUnderlying,
          [-100, -100],
          scaledBN(1000, 8),
        )

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('40000')
      })

      it('delta increases', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -90,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('26000')
      })

      it('delta increases but no enough usdc', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes 0', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes positive', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })
    })

    describe('delta of squared is negative and delta of future is positive', () => {
      beforeEach(async () => {
        await tester.addCollateral(SQEETH_PRODUCT_ID, {
          gamma0: 0,
          delta0: -120,
          delta1: 100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: -120,
          delta1: 100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountsUnderlying,
          [-120, 100],
          scaledBN(1000, 8),
        )

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('120')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('3091')
      })

      it('delta decreases', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('170000')
      })

      it('delta becomes 0', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('100000')
      })

      it('delta becomes negative', async function () {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -50,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('170000')
      })
    })
  })

  describe('getRequiredTokenAmountsForHedge', () => {
    describe('neutral', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([0, 0], [-100, -100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('100'), BigNumber.from('100')])
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([0, 0], [-120, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(20000)
        expect(params.amountUnderlying).to.be.eq(20)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('120'), BigNumber.from('-100')])
      })

      it('deltas are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([0, 0], [0, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('0'), BigNumber.from('0')])
      })
    })

    describe('underlying positions are positive', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, 100], [-100, -100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('0'), BigNumber.from('0')])
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, 100], [-120, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(180000)
        expect(params.amountUnderlying).to.be.eq(180)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('20'), BigNumber.from('-200')])
      })

      it('delta are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, 100], [0, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('-100'), BigNumber.from('-100')])
      })

      it('delta are greater than underlying positions', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, 100], [0, 200], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('-100'), BigNumber.from('-100')])
      })
    })

    describe('underlying position of squared perpetual is positive and underlying position of perpetual future is negative', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, -100], [-100, -100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('0'), BigNumber.from('200')])
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, -100], [-120, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(20000)
        expect(params.amountUnderlying).to.be.eq(20)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('20'), BigNumber.from('0')])
      })

      it('deltas are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge([100, -100], [0, 100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.amountsRequiredUnderlying).to.be.deep.eq([BigNumber.from('-100'), BigNumber.from('100')])
      })
    })
  })

  describe('complete', () => {
    async function complete(deltas: [BigNumberish, BigNumberish], spotPrice: number) {
      await tester.complete(
        await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountsUnderlying,
          deltas,
          scaledBN(spotPrice, 8),
        ),
      )
    }

    it('reverts if there are no positions', async function () {
      await tester.addCollateral(SQEETH_PRODUCT_ID, {
        gamma0: 0,
        delta0: 0,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolCollateralRiskParam,
      })

      await expect(complete([0, 0], 1000)).to.be.revertedWith('N1')
    })

    describe('short squared perpetual', () => {
      beforeEach(async () => {
        await tester.addCollateral(SQEETH_PRODUCT_ID, {
          gamma0: -2,
          delta0: -100,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([-100, 0], 1000)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1160000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('spot price becomes high', async function () {
        await complete([-100, 0], 1100)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1150000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('reverts if spot price becomes very high', async function () {
        await expect(complete([-300, 0], 5000)).to.be.revertedWith('N2')
      })

      it('spot price becomes low', async function () {
        await complete([-100, 0], 900)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1170000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })
    })

    describe('short perpetual future', () => {
      beforeEach(async () => {
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: 0,
          delta0: 0,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([0, -100], 1000)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('spot price becomes high', async function () {
        await complete([0, -100], 1100)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('30000')
      })

      it('spot price becomes low', async function () {
        await complete([0, -100], 900)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('50000')
      })
    })

    describe('short squared perpetual and short perpetual future', () => {
      beforeEach(async () => {
        await tester.addCollateral(SQEETH_PRODUCT_ID, {
          gamma0: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([-100, -100], 1000)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1160000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('spot price becomes high', async function () {
        await complete([-120, -100], 1200)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('120')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1116000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('20000')
      })

      it('spot price becomes low', async function () {
        await complete([-90, -100], 900)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('90')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1179000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('50000')
      })
    })

    describe('short squared perpetual and long perpetual future', () => {
      beforeEach(async () => {
        await tester.addCollateral(SQEETH_PRODUCT_ID, {
          gamma0: -2,
          delta0: -120,
          delta1: 100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
        await tester.addCollateral(FUTURE_PRODUCT_ID, {
          gamma0: -2,
          delta0: -120,
          delta1: 100,
          spotPrice: scaledBN(1000, 8),
          poolCollateralRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([-120, 100], 1000)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('120')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1123091')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('-100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('3510')
      })

      it('spot price becomes high', async function () {
        await complete([-120, 100], 1100)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('120')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1122000')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('-100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('2600')
      })

      it('spot price becomes low', async function () {
        await complete([-120, 100], 900)

        const info = await tester.getInfo()

        expect(info.amountsUnderlying[SQEETH_PRODUCT_ID]).to.be.eq('120')
        expect(info.amountsUsdc[SQEETH_PRODUCT_ID]).to.be.eq('1124182')
        expect(info.amountsUnderlying[FUTURE_PRODUCT_ID]).to.be.eq('-100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('4419')
      })
    })
  })
})
