import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQUEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('TraderVaultLib', function () {
  let tester: TraderVaultLibTester

  beforeEach(async () => {
    const TraderVaultLib = await ethers.getContractFactory('TraderVaultLib')
    const traderVaultLib = await TraderVaultLib.deploy()

    const TraderVaultLibTester = await ethers.getContractFactory('TraderVaultLibTester', {
      libraries: {
        TraderVaultLib: traderVaultLib.address,
      },
    })
    tester = (await TraderVaultLibTester.deploy()) as TraderVaultLibTester
  })

  describe('updateVault', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      })

      it('there is a sub-vault', async function () {
        const subVault = await tester.getSubVault(0)

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('100000000')
      })

      it('close positions', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      it('close positions with funding payment', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(-10000)
      })

      it('close positions with funding received', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '-10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(10000)
      })

      it('close and open opposit-side positions', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-200000000', '10000000000', '0')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('-100000000')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      it('close and open opposit-side positions with funding payment', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-200000000', '10000000000', '10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('-100000000')
        expect(vault.positionUsdc).to.be.eq(-10000)
      })
    })

    describe('multiple sub-vaults', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      })

      it('there are two sub-vaults', async function () {
        const subVault = await tester.getSubVault(1)

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('100000000')
      })

      it('close positions', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const subVault = await tester.getSubVault(1)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQUEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      describe('multiple products in multiple sub-vaults', () => {
        beforeEach(async () => {
          await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
          await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '100000000', '10000000000', '0')
        })

        it('there are two sub-vaults', async function () {
          const subVault = await tester.getSubVault(1)

          expect(subVault.positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq('100000000')
        })

        it('close positions', async function () {
          await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
          await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '-100000000', '10000000000', '0')

          const subVault = await tester.getSubVault(1)
          const vault = await tester.traderVault()

          expect(subVault.positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq('0')
          expect(vault.positionUsdc).to.be.eq(0)
        })
      })
    })

    it('reverts if sub-vault index is too large', async function () {
      await expect(tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')).to.be.revertedWith(
        'T3',
      )
    })
  })

  describe('getMinCollateral', () => {
    async function checkMinCollateral(
      positionPerpetuals: BigNumberish[],
      fundingRates: BigNumberish[],
      spotPrice: BigNumberish,
      expectedMinCollateral: BigNumberish,
    ) {
      const spot = BigNumber.from(spotPrice)
      const futurePrice = spot.mul(BigNumber.from(fundingRates[0]).add('100000000')).div('100000000')
      const squeethPrice = spot
        .mul(spot)
        .div('10000')
        .mul(BigNumber.from(fundingRates[1]).add('100000000'))
        .div('100000000')
      if (!BigNumber.from(positionPerpetuals[0]).eq(0)) {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, positionPerpetuals[0], futurePrice, '0')
      }
      if (!BigNumber.from(positionPerpetuals[1]).eq(0)) {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, positionPerpetuals[1], squeethPrice, '0')
      }
      const minCollateral = await tester.getMinCollateral({
        spotPrice: spotPrice,
        tradePrices: [futurePrice, squeethPrice],
        fundingRates: [fundingRates[0], fundingRates[1]],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(minCollateral).to.be.eq(expectedMinCollateral)
    }

    it('long squeeth', async function () {
      await checkMinCollateral([0, '1000000000'], [0, 0], '500000000000', '403125000000')
    })

    it('short squeeth', async function () {
      await checkMinCollateral([0, '-1000000000'], [0, 0], '500000000000', '403125000000')
    })

    it('long future', async function () {
      await checkMinCollateral(['1000000000', 0], [0, 0], '100000000000', '75000000000')
    })

    it('short future', async function () {
      await checkMinCollateral(['-1000000000', 0], [0, 0], '100000000000', '75000000000')
    })

    describe('short future and long squeeth', () => {
      it('long future and short squeeth with positive delta', async function () {
        await checkMinCollateral(['-2000000000', '2000000000'], [0, 0], '400000000000', '156000000000')
      })

      it('long future and short squeeth with zero delta', async function () {
        await checkMinCollateral(['-2000000000', '2000000000'], [0, 0], '500000000000', '56250000000')
      })

      it('long future and short squeeth with negative delta', async function () {
        await checkMinCollateral(['-2000000000', '2000000000'], [0, 0], '600000000000', '261000000000')
      })

      it('long future and short squeeth with funding rate', async function () {
        await checkMinCollateral(['-2000000000', '2000000000'], ['100000', '1000000'], '500000000000', '63562500000')
      })
    })

    describe('long future and short squeeth', () => {
      it('long future and short squeeth with positive delta', async function () {
        await checkMinCollateral(['2000000000', '-2000000000'], [0, 0], '400000000000', '156000000000')
      })

      it('long future and short squeeth with zero delta', async function () {
        await checkMinCollateral(['2000000000', '-2000000000'], [0, 0], '500000000000', '56250000000')
      })

      it('long future and short squeeth with negative delta', async function () {
        await checkMinCollateral(['2000000000', '-2000000000'], [0, 0], '600000000000', '261000000000')
      })

      it('long future and short squeeth with funding rate', async function () {
        await checkMinCollateral(['2000000000', '-2000000000'], ['100000', '1000000'], '500000000000', '63562500000')
      })
    })

    it('short squeeth and short future', async function () {
      await checkMinCollateral(['-1000000000', '-1000000000'], [0, 0], '100000000000', '91125000000')
    })

    it('positions in different sub-vaults', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-500000000', '50000000000', '0')
      await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '-500000000', '50000000000', '0')
      const minCollateral = await tester.getMinCollateral({
        spotPrice: '100000000000',
        tradePrices: ['100000000000', '10000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(minCollateral).to.be.eq('91125000000')
    })

    it('min limit is 500 * 1e8', async function () {
      await checkMinCollateral([0, '1'], [0, 0], '10000000000', '50000000000')
    })
  })

  describe('getPositionValue', () => {
    afterEach(async () => {
      // Close all positions
      const numOfSubVaults = await tester.getNumOfSubVault()
      for (let i = 0; i < numOfSubVaults.toNumber(); i++) {
        const subVault = await tester.getSubVault(i)
        if (!subVault.positionPerpetuals[SQUEETH_PRODUCT_ID].eq(0)) {
          await tester.testUpdateVault(
            i,
            SQUEETH_PRODUCT_ID,
            -subVault.positionPerpetuals[SQUEETH_PRODUCT_ID],
            '10000000000',
            '1000',
          )
        }
        if (!subVault.positionPerpetuals[FUTURE_PRODUCT_ID].eq(0)) {
          await tester.testUpdateVault(
            i,
            FUTURE_PRODUCT_ID,
            -subVault.positionPerpetuals[FUTURE_PRODUCT_ID],
            '100000000000',
            '1000',
          )
        }
      }

      // Check that positionUsdc is equal to positionValue when all positions are closed
      const positionValue = await tester.getPositionValue({
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [1000, 1000],
      })

      expect((await tester.traderVault()).positionUsdc).to.be.eq(positionValue)
    })

    describe('ETH price becomes high', () => {
      it('1 long squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '11000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(2100000000)
      })

      it('1 short squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-2100000000)
      })

      it('1 long future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(10000000000)
      })

      it('1 short future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-10000000000)
      })

      it('1 long squeeth and 0.2 short future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-20000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short squeeth and 1 long future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })

      it('1 short squeeth and 1 long future in different sub-vaults', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')
        await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })
    })

    describe('funding fee', () => {
      it('1 long squeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short squeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [-1000000, 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [-1000000, 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })
    })
  })

  describe('getMinCollateralToAddPosition', () => {
    it('get min collateral of the vault', async function () {
      const minCollateral = await tester.testGetMinCollateralToAddPosition([0, '1000000000'], {
        spotPrice: '100000000000',
        tradePrices: ['100000000000', '10000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(minCollateral).to.be.eq('50000000000')
    })

    describe('USDCs are deposited', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('50000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('get min collateral of the vault which has positions', async function () {
        const minCollateral = await tester.testGetMinCollateralToAddPosition([0, '1000000000'], {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(minCollateral).to.be.eq('50000000000')
      })
    })
  })

  describe('updateUsdcPosition', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('100000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('100000000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq(100000000000)
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('100000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-200000000000', {
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-71000000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('29000000000')
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '5000000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '5000000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('200000000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('200000000000')
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-500000000000', {
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-214887500000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('-14887500000')
      })
    })
  })

  describe('checkVaultIsLiquidatable', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '7000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('112900000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '95000000000',
            tradePrices: ['95000000000', '9025000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.true
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [500000000, 500000000],
          }),
        ).to.be.true
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')

        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '95000000000',
          tradePrices: ['95000000000', '9025000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })
  })

  describe('setInsolvencyFlagIfNeeded', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '7000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('112900000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('reverts if there are positions', async function () {
        await expect(tester.testSetInsolvencyFlagIfNeeded()).to.be.reverted
      })

      it('vault is not insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-7000000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('vault is insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-7000000000', '8000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.true
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '3500000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '3500000000', '10000000000', '0')

        await tester.testUpdateUsdcPosition('112900000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('vault is not insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-3500000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '-3500000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('vault is insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-3500000000', '8000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '-3500000000', '8000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.true
      })
    })
  })

  describe('decreaseLiquidationReward', () => {
    const liquidationFee = 2000

    beforeEach(async () => {
      await tester.testUpdateUsdcPosition('200000000', {
        spotPrice: '100000000000',
        tradePrices: ['100000000000', '10000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [0, 0],
      })
    })

    it('reward is 0.2 of MinCollateral', async function () {
      await tester.testDecreaseLiquidationReward(scaledBN(10, 8), liquidationFee)
      expect(await tester.r()).to.be.eq(200000000)
      expect((await tester.traderVault()).positionUsdc).to.be.eq(0)
    })

    it('reward is equal to usdcPosition', async function () {
      await tester.testDecreaseLiquidationReward(scaledBN(5, 7), liquidationFee)
      expect(await tester.r()).to.be.eq(10000000)
      expect((await tester.traderVault()).positionUsdc).to.be.eq(190000000)
    })
  })
})
