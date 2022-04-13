import { expect } from 'chai'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { NettingLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQUEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('NettingLib', function () {
  let tester: NettingLibTester

  const poolMarginRiskParam = 4000

  beforeEach(async () => {
    const NettingLibTester = await ethers.getContractFactory('NettingLibTester')

    tester = (await NettingLibTester.deploy()) as NettingLibTester
  })

  describe('getRequiredMargin', () => {
    it('no positions', async function () {
      expect(
        await tester.getRequiredMargin(SQUEETH_PRODUCT_ID, {
          gamma1: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        }),
      ).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      expect(
        await tester.getRequiredMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: 0,
          delta1: -2000,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        }),
      ).to.be.eq('3920000')
    })

    it('short future', async function () {
      expect(
        await tester.getRequiredMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -10,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        }),
      ).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      expect(
        await tester.getRequiredMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: 2000,
          delta1: -2000,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        }),
      ).to.be.eq('1120000')
    })

    it('long sqeeth and short future', async function () {
      const a0 = await tester.getRequiredMargin(SQUEETH_PRODUCT_ID, {
        gamma1: 2000,
        delta0: -2000000,
        delta1: 400000,
        spotPrice: scaledBN(200, 8),
        poolMarginRiskParam: 2000,
      })
      const a1 = await tester.getRequiredMargin(SQUEETH_PRODUCT_ID, {
        gamma1: 2000,
        delta0: -2000000,
        delta1: 400000,
        spotPrice: scaledBN(200, 8),
        poolMarginRiskParam: 4000,
      })
      console.log(a0.toString(), a1.toString())
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

  describe('addMargin', () => {
    it('no positions', async function () {
      await tester.addMargin(SQUEETH_PRODUCT_ID, {
        gamma1: 0,
        delta0: 0,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolMarginRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('0')
    })

    it('short sqeeth', async function () {
      await tester.addMargin(SQUEETH_PRODUCT_ID, {
        gamma1: -2,
        delta0: 0,
        delta1: -10,
        spotPrice: scaledBN(1000, 8),
        poolMarginRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1134000')
    })

    it('short future', async function () {
      await tester.addMargin(FUTURE_PRODUCT_ID, {
        gamma1: 0,
        delta0: -10,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolMarginRiskParam,
      })
      expect((await tester.getInfo()).amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('14000')
    })

    it('short sqeeth and long future', async function () {
      await tester.addMargin(SQUEETH_PRODUCT_ID, {
        gamma1: -2,
        delta0: 10,
        delta1: -10,
        spotPrice: scaledBN(1000, 8),
        poolMarginRiskParam,
      })

      expect((await tester.getInfo()).amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1120000')
    })

    describe('delta of perpetual future is negative', () => {
      beforeEach(async () => {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -100,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(0, [-100, 0], scaledBN(1000, 8))

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('delta increases', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -90,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('26000')
      })

      it('delta increases but no enough usdc', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -50,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('-30000')
      })

      it('delta becomes 0', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes positive', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 50,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('-30000')
      })
    })

    describe('deltas are negative', () => {
      beforeEach(async () => {
        await tester.addMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountUnderlying,
          [-100, -100],
          scaledBN(1000, 8),
        )

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('200')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1160000')
      })

      it('delta increases', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -90,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('29864')
      })

      it('delta increases but no enough usdc', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -50,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('-130000')
      })

      it('delta becomes 0', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('delta becomes positive', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 50,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('-130000')
      })
    })

    describe('delta of squared is negative and delta of future is positive', () => {
      beforeEach(async () => {
        await tester.addMargin(SQUEETH_PRODUCT_ID, {
          gamma1: 0,
          delta0: 100,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 100,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const params = await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountUnderlying,
          [100, -120],
          scaledBN(1000, 8),
        )

        await tester.complete(params)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('20')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq(3510)
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq(3090)
      })

      it('delta decreases', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 50,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq(22118)
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq(3090)
      })

      it('delta becomes 0', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: 0,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq(0)
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq(3090)
      })

      it('delta becomes negative', async function () {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -50,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })

        const info = await tester.getInfo()
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq(62718)
      })
    })
  })

  describe('getRequiredTokenAmountsForHedge', () => {
    describe('neutral', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [-100, -100], scaledBN(1000, 8))

        expect(params.isLong).to.be.true
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.futureWeight).to.be.deep.eq('5000000000000000')
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [100, -120], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(20000)
        expect(params.amountUnderlying).to.be.eq(20)
        expect(params.futureWeight).to.be.deep.eq('4545454545454545')
      })

      it('deltas are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [100, 0], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.futureWeight).to.be.deep.eq('10000000000000000')
      })
    })

    describe('underlying positions are positive', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(200, [-100, -100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.futureWeight).to.be.deep.eq('5000000000000000')
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(200, [100, -120], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(180000)
        expect(params.amountUnderlying).to.be.eq(180)
        expect(params.futureWeight).to.be.deep.eq('4545454545454545')
      })

      it('delta are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(200, [100, 0], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.futureWeight).to.be.deep.eq('10000000000000000')
      })

      it('delta are greater than underlying positions', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(200, [200, 0], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.futureWeight).to.be.deep.eq('10000000000000000')
      })
    })

    describe('underlying position of squared perpetual is positive and underlying position of perpetual future is negative', () => {
      it('deltas are negative', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [-100, -100], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(200000)
        expect(params.amountUnderlying).to.be.eq(200)
        expect(params.futureWeight).to.be.deep.eq('5000000000000000')
      })

      it('delta of squared perpetual is negative and delta of perpetual future is positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [100, -120], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(20000)
        expect(params.amountUnderlying).to.be.eq(20)
        expect(params.futureWeight).to.be.deep.eq('4545454545454545')
      })

      it('deltas are positive', async function () {
        const params = await tester.getRequiredTokenAmountsForHedge(0, [100, 0], scaledBN(1000, 8))
        expect(params.amountUsdc).to.be.eq(0)
        expect(params.amountUnderlying).to.be.eq(0)
        expect(params.futureWeight).to.be.deep.eq('10000000000000000')
      })
    })
  })

  describe('complete', () => {
    async function complete(deltas: [BigNumberish, BigNumberish], spotPrice: number) {
      await tester.complete(
        await tester.getRequiredTokenAmountsForHedge(
          (
            await tester.getInfo()
          ).amountUnderlying,
          deltas,
          scaledBN(spotPrice, 8),
        ),
      )
    }

    it('reverts if there are no positions', async function () {
      await tester.addMargin(SQUEETH_PRODUCT_ID, {
        gamma1: 0,
        delta0: 0,
        delta1: 0,
        spotPrice: scaledBN(1000, 8),
        poolMarginRiskParam,
      })

      await expect(complete([0, 0], 1000)).to.be.revertedWith('N1')
    })

    describe('short squared perpetual', () => {
      beforeEach(async () => {
        await tester.addMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: 0,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([0, -100], 1000)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1160000')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('spot price becomes high', async function () {
        await complete([0, -100], 1100)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1150000')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })

      it('spot price becomes very high', async function () {
        await complete([0, -300], 5000)

        const info = await tester.getInfo()
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.lt(0)
      })

      it('spot price becomes low', async function () {
        await complete([0, -100], 900)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1170000')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('0')
      })
    })

    describe('short perpetual future', () => {
      beforeEach(async () => {
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: 0,
          delta0: -100,
          delta1: 0,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([-100, 0], 1000)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('spot price becomes high', async function () {
        await complete([-100, 0], 1100)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('30000')
      })

      it('spot price becomes low', async function () {
        await complete([-100, 0], 900)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('100')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('50000')
      })
    })

    describe('short squared perpetual and short perpetual future', () => {
      beforeEach(async () => {
        await tester.addMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: -2,
          delta0: -100,
          delta1: -100,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([-100, -100], 1000)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('200')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1160000')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('40000')
      })

      it('spot price becomes high', async function () {
        await complete([-100, -120], 1200)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('220')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1115999')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('20001')
      })

      it('spot price becomes low', async function () {
        await complete([-100, -90], 900)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('190')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1178999')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('50001')
      })
    })

    describe('short squared perpetual and long perpetual future', () => {
      beforeEach(async () => {
        await tester.addMargin(SQUEETH_PRODUCT_ID, {
          gamma1: -2,
          delta0: 100,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
        await tester.addMargin(FUTURE_PRODUCT_ID, {
          gamma1: -2,
          delta0: 100,
          delta1: -120,
          spotPrice: scaledBN(1000, 8),
          poolMarginRiskParam,
        })
      })

      it('spot price not changed', async function () {
        await complete([100, -120], 1000)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('20')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1123090')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('3510')
      })

      it('spot price becomes high', async function () {
        await complete([100, -120], 1100)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('20')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1121999')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('2601')
      })

      it('spot price becomes low', async function () {
        await complete([100, -120], 900)

        const info = await tester.getInfo()

        expect(info.amountUnderlying).to.be.eq('20')
        expect(info.amountsUsdc[SQUEETH_PRODUCT_ID]).to.be.eq('1124181')
        expect(info.amountsUsdc[FUTURE_PRODUCT_ID]).to.be.eq('4419')
      })
    })
  })
})
