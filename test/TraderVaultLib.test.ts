import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQUEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN } from './utils/helpers'

describe('TraderVaultLib', function () {
  let tester: TraderVaultLibTester

  beforeEach(async () => {
    const TraderVaultLibTester = await ethers.getContractFactory('TraderVaultLibTester')

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
    it('1 long squeeth', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('15000000000')
    })

    it('1 short squeeth', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('15000000000')
    })

    it('1 long future', async function () {
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('75000000000')
    })

    it('1 short future', async function () {
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('75000000000')
    })

    it('1 long squeeth and 1 short future', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('60000000000')
    })

    it('1 short squeeth and 1 long future', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-1000000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('90000000000')
    })

    it('1 short squeeth and 1 long future in different sub-vaults', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-500000000', '50000000000', '0')
      await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '-500000000', '50000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('90000000000')
    })

    it('min limit is 100 * 1e8', async function () {
      await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq('10000000000')
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
        amountsFundingPaidPerPosition: [1000, 1000],
      })

      expect((await tester.traderVault()).positionUsdc).to.be.eq(positionValue)
    })

    describe('ETH price becomes high', () => {
      it('1 long squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '11000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(2100000000)
      })

      it('1 short squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-2100000000)
      })

      it('1 long future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(10000000000)
      })

      it('1 short future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-10000000000)
      })

      it('1 long squeeth and 0.2 short future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-20000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short squeeth and 1 long future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
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
          tradePrices: ['12100000000', '110000000000'],
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
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short squeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, -1000000],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, -1000000],
        })
        expect(positionValue).to.be.eq(-1000000)
      })
    })
  })

  describe('getAmountRequired', () => {
    it('spot is not specified', async function () {
      const result = await tester.testGetAmountRequired(['1000', 0], '100000000', 0, {
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(result[0]).to.be.eq('10000000000')
      expect(result[1]).to.be.eq('10000000000')
    })

    it('spot is specified', async function () {
      const result = await tester.testGetAmountRequired(['1000', 0], '100000000', '200000000000', {
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(result[0]).to.be.eq('10000000000')
      expect(result[1]).to.be.eq('10000000000')
    })

    describe('USDCs are deposited', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('spot is not specified', async function () {
        const result = await tester.testGetAmountRequired(['1000', 0], '100000000', 0, {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(result[0]).to.be.eq('-4999985000')
        expect(result[1]).to.be.eq('15000015000')
      })

      it('spot is specified', async function () {
        const result = await tester.testGetAmountRequired(['1000', 0], '100000000', '200000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(result[0]).to.be.eq('40000060000')
        expect(result[1]).to.be.eq('60000060000')
      })

      it('ratio is 50%', async function () {
        const result = await tester.testGetAmountRequired(['1000', 0], '50000000', 0, {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(result[0]).to.be.eq('10000030000')
        expect(result[1]).to.be.eq('15000015000')
      })
    })
  })

  describe('updateUsdcPosition', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('20000000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq(20000000000)
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-100000000000', {
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-22850000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('-2850000000')
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '500000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '500000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('20000000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('20000000000')
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-100000000000', {
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-22850000000')
        expect((await tester.traderVault()).positionUsdc).to.be.eq('-2850000000')
      })
    })
  })

  describe('checkVaultIsLiquidatable', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('10000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '95000000000',
            tradePrices: ['9025000000', '95000000000'],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.true
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountsFundingPaidPerPosition: [100, 100],
          }),
        ).to.be.true
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')

        await tester.testUpdateUsdcPosition('20000000000', {
          spotPrice: '95000000000',
          tradePrices: ['9025000000', '95000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })
  })

  describe('setInsolvencyFlagIfNeeded', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('15000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('reverts if there are positions', async function () {
        await expect(tester.testSetInsolvencyFlagIfNeeded()).to.be.reverted
      })

      it('vault is not insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('vault is insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-1000000000', '8000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.true
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '500000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '500000000', '10000000000', '0')

        await tester.testUpdateUsdcPosition('15000000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('vault is not insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-500000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '-500000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('vault is insolvent', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-500000000', '8000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '-500000000', '8000000000', '0')

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
        tradePrices: ['10000000000', '100000000000'],
        amountsFundingPaidPerPosition: [0, 0],
      })
    })

    it('decrease reward', async function () {
      await tester.testDecreaseLiquidationReward(liquidationFee)
      expect(await tester.r()).to.be.eq(40000000)
      expect((await tester.traderVault()).positionUsdc).to.be.eq(160000000)
    })
  })
})
