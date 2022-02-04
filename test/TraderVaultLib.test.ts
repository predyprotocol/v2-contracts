import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQEETH_PRODUCT_ID } from './utils/constants'
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
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      })

      it('there is a sub-vault', async function () {
        const subVault = await tester.getSubVault(0)

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('100000000')
      })

      it('close positions', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      it('close positions with funding payment', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(-10000)
      })

      it('close positions with funding received', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '-10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(10000)
      })

      it('close and open opposit-side positions', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-200000000', '10000000000', '0')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('-100000000')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      it('close and open opposit-side positions with funding payment', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-200000000', '10000000000', '10000')

        const subVault = await tester.getSubVault(0)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('-100000000')
        expect(vault.positionUsdc).to.be.eq(-10000)
      })
    })

    describe('multiple sub-vaults', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      })

      it('there are two sub-vaults', async function () {
        const subVault = await tester.getSubVault(1)

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('100000000')
      })

      it('close positions', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const subVault = await tester.getSubVault(1)
        const vault = await tester.traderVault()

        expect(subVault.positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq('0')
        expect(vault.positionUsdc).to.be.eq(0)
      })

      describe('multiple products in multiple sub-vaults', () => {
        beforeEach(async () => {
          await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
          await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '100000000', '10000000000', '0')
        })

        it('there are two sub-vaults', async function () {
          const subVault = await tester.getSubVault(1)

          expect(subVault.positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq('100000000')
        })

        it('close positions', async function () {
          await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
          await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '-100000000', '10000000000', '0')

          const subVault = await tester.getSubVault(1)
          const vault = await tester.traderVault()

          expect(subVault.positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq('0')
          expect(vault.positionUsdc).to.be.eq(0)
        })
      })
    })

    it('reverts if sub-vault index is too large', async function () {
      await expect(tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')).to.be.revertedWith(
        'T3',
      )
    })
  })

  describe('getMinCollateral', () => {
    it('1 long sqeeth', async function () {
      await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(1500000000)
    })

    it('1 short sqeeth', async function () {
      await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(1500000000)
    })

    it('1 long future', async function () {
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(7500000000)
    })

    it('1 short future', async function () {
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(7500000000)
    })

    it('1 long sqeeth and 1 short future', async function () {
      await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(6000000000)
    })

    it('1 short sqeeth and 1 long future', async function () {
      await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '10000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(9000000000)
    })

    it('1 short sqeeth and 1 long future in different sub-vaults', async function () {
      await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
      await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-50000000', '50000000000', '0')
      await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '-50000000', '50000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(9000000000)
    })
  })

  describe('getPositionValue', () => {
    afterEach(async () => {
      // Close all positions
      const numOfSubVaults = await tester.getNumOfSubVault()
      for (let i = 0; i < numOfSubVaults.toNumber(); i++) {
        const subVault = await tester.getSubVault(i)
        if (!subVault.positionPerpetuals[SQEETH_PRODUCT_ID].eq(0)) {
          await tester.testUpdateVault(
            i,
            SQEETH_PRODUCT_ID,
            -subVault.positionPerpetuals[SQEETH_PRODUCT_ID],
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
        amountFundingFeesPerPosition: [1000, 1000],
      })

      expect((await tester.traderVault()).positionUsdc).to.be.eq(positionValue)
    })

    describe('ETH price becomes high', () => {
      it('1 long sqeeth', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '11000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(2100000000)
      })

      it('1 short sqeeth', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-2100000000)
      })

      it('1 long future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(10000000000)
      })

      it('1 short future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-10000000000)
      })

      it('1 long sqeeth and 0.2 short future', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-20000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short sqeeth and 1 long future', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })

      it('1 short sqeeth and 1 long future in different sub-vaults', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')
        await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })
    })

    describe('funding fee', () => {
      it('1 long sqeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short sqeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [1000000, 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 1000000],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, -1000000],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, -1000000],
        })
        expect(positionValue).to.be.eq(-1000000)
      })
    })
  })

  describe('getAmountRequired', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(usdcAmount).to.be.eq(1500000000)
      })

      it('there is excess collateral', async function () {
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
        const usdcAmount2 = await tester.testGetAmountRequired('100000000', {
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(usdcAmount2).to.be.eq(-1785000000)
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(usdcAmount).to.be.eq(1500000000)
      })

      it('there is excess collateral', async function () {
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
        const usdcAmount2 = await tester.testGetAmountRequired('100000000', {
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        expect(usdcAmount2).to.be.eq(-1785000000)
      })
    })
  })

  describe('checkVaultIsLiquidatable', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '95000000000',
            tradePrices: ['9025000000', '95000000000'],
            amountFundingFeesPerPosition: [0, 0],
          }),
        ).to.be.true
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountFundingFeesPerPosition: [100, 100],
          }),
        ).to.be.true
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountFundingFeesPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')

        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '95000000000',
          tradePrices: ['9025000000', '95000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountFundingFeesPerPosition: [0, 0],
          }),
        ).to.be.false
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['10000000000', '100000000000'],
            amountFundingFeesPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })
  })

  describe('setInsolvencyFlagIfNeeded', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
      })

      it('liquidate a vault', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('liquidate a vault', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-100000000', '8000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.true
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '50000000', '10000000000', '0')

        const usdcAmount = await tester.testGetAmountRequired('100000000', {
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition(usdcAmount)
      })

      it('liquidate a vault', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '-50000000', '10000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.false
      })

      it('liquidate a vault', async function () {
        await tester.testUpdateVault(0, SQEETH_PRODUCT_ID, '-50000000', '8000000000', '0')
        await tester.testUpdateVault(1, SQEETH_PRODUCT_ID, '-50000000', '8000000000', '0')

        await tester.testSetInsolvencyFlagIfNeeded()

        expect((await tester.traderVault()).isInsolvent).to.be.true
      })
    })
  })

  describe('decreaseLiquidationReward', () => {
    const liquidationFee = 2000

    beforeEach(async () => {
      await tester.testUpdateUsdcPosition(scaledBN(200, 6))
    })

    it('decrease reward', async function () {
      await tester.testDecreaseLiquidationReward(liquidationFee)
      expect(await tester.r()).to.be.eq(40000000)
      expect((await tester.traderVault()).positionUsdc).to.be.eq(160000000)
    })
  })
})
