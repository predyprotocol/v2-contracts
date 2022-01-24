import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQEETH_PRODUCT_ID } from './utils/constants'

describe('TraderVaultLib', function () {
  let tester: TraderVaultLibTester

  beforeEach(async () => {
    const TraderVaultLibTester = await ethers.getContractFactory('TraderVaultLibTester')

    tester = (await TraderVaultLibTester.deploy()) as TraderVaultLibTester
  })

  describe('getMinCollateral', () => {
    it('1 long sqeeth', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(15000000)
    })

    it('1 short sqeeth', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '-100000000', '-1000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(15000000)
    })

    it('1 long future', async function () {
      await tester.testUpdateVault(FUTURE_PRODUCT_ID, '100000000', '10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(75000000)
    })

    it('1 short future', async function () {
      await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '-10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(75000000)
    })

    it('1 long sqeeth and 1 short future', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
      await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '-10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(60000000)
    })

    it('1 short sqeeth and 1 long future', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '-100000000', '-1000000000000000000', '0')
      await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(90000000)
    })
  })

  describe('getPositionValue', () => {
    describe('ETH price becomes high', () => {
      it('1 long sqeeth', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '11000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(21000000)
      })

      it('1 short sqeeth', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '-100000000', '-1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(-21000000)
      })

      it('1 long future', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short future', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '-10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(-100000000)
      })

      it('1 long sqeeth and 0.2 short future', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-20000000', '-2000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short sqeeth and 1 long future', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '-100000000', '-1000000000000000000', '0')
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['12100000000', '110000000000'],
          amountFundingFeesPerSize: [0, 0],
        })
        expect(positionValue).to.be.eq(-2121000000)
      })
    })

    describe('funding fee', () => {
      it('1 long sqeeth and positive funding fee', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [1000000, 0],
        })
        expect(positionValue).to.be.eq(-10000)
      })

      it('1 short sqeeth and positive funding fee', async function () {
        await tester.testUpdateVault(SQEETH_PRODUCT_ID, '-100000000', '-1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [1000000, 0],
        })
        expect(positionValue).to.be.eq(10000)
      })

      it('1 long future and positive funding fee', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [0, 1000000],
        })
        expect(positionValue).to.be.eq(-10000)
      })

      it('1 short future and positive funding fee', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '-10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [0, 1000000],
        })
        expect(positionValue).to.be.eq(10000)
      })

      it('1 long future and negative funding fee', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [0, -1000000],
        })
        expect(positionValue).to.be.eq(10000)
      })

      it('1 short future and negative funding fee', async function () {
        await tester.testUpdateVault(FUTURE_PRODUCT_ID, '-100000000', '-10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [0, -1000000],
        })
        expect(positionValue).to.be.eq(-10000)
      })
    })
  })

  describe('getAmountRequired', () => {
    it('more collateral required', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
      const usdcAmount = await tester.testGetAmountRequired('100000000', {
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      expect(usdcAmount).to.be.eq(15000000)
    })

    it('there is excess collateral', async function () {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
      const usdcAmount = await tester.testGetAmountRequired('100000000', {
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      await tester.testUpdateUsdcAmount(usdcAmount)
      const usdcAmount2 = await tester.testGetAmountRequired('100000000', {
        spotPrice: '110000000000',
        tradePrices: ['12100000000', '110000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      expect(usdcAmount2).to.be.eq(-17850000)
    })
  })

  describe('liquidate', () => {
    beforeEach(async () => {
      await tester.testUpdateVault(SQEETH_PRODUCT_ID, '100000000', '1000000000000000000', '0')
      const usdcAmount = await tester.testGetAmountRequired('100000000', {
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      await tester.testUpdateUsdcAmount(usdcAmount)
    })

    it('reverts if position value is greater than min collateral', async function () {
      await expect(
        tester.testLiquidate({
          spotPrice: '100000000000',
          tradePrices: ['10000000000', '100000000000'],
          amountFundingFeesPerSize: [0, 0],
        }),
      ).to.be.revertedWith('T1')

      expect((await tester.traderPosition()).amountUsdc).to.be.eq(15000000)
    })

    it('liquidate a vault', async function () {
      await tester.testLiquidate({
        spotPrice: '95000000000',
        tradePrices: ['9025000000', '95000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      expect((await tester.traderPosition()).amountUsdc).to.be.eq(12375000)
    })

    it('vault is insolvency', async function () {
      await tester.testLiquidate({
        spotPrice: '90000000000',
        tradePrices: ['8100000000', '90000000000'],
        amountFundingFeesPerSize: [0, 0],
      })
      const traderPosition = await tester.traderPosition()
      expect(traderPosition.amountUsdc).to.be.eq(15000000)
      expect(traderPosition.isInsolvent).to.be.eq(true)
    })

    it('position value is decreased by funding fee', async function () {
      await tester.testLiquidate({
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        amountFundingFeesPerSize: [100, 100],
      })
      expect((await tester.traderPosition()).amountUsdc).to.be.eq(7500001)
    })
  })
})
