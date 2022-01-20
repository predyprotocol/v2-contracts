import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'

describe('TraderVaultLib', function () {
  let tester: TraderVaultLibTester

  beforeEach(async () => {
    const TraderVaultLibTester = await ethers.getContractFactory('TraderVaultLibTester')

    tester = (await TraderVaultLibTester.deploy()) as TraderVaultLibTester
  })

  describe('getMinCollateral', () => {
    it('1 long sqeeth', async function () {
      await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(15000000)
    })

    it('1 short sqeeth', async function () {
      await tester.testUpdatePosition(0, '-100000000', '-1000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(15000000)
    })

    it('1 long future', async function () {
      await tester.testUpdatePosition(1, '100000000', '10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(75000000)
    })

    it('1 short future', async function () {
      await tester.testUpdatePosition(1, '-100000000', '-10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(75000000)
    })

    it('1 long sqeeth and 1 short future', async function () {
      await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
      await tester.testUpdatePosition(1, '-100000000', '-10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(60000000)
    })

    it('1 short sqeeth and 1 long future', async function () {
      await tester.testUpdatePosition(0, '-100000000', '-1000000000000000000', '0')
      await tester.testUpdatePosition(1, '-100000000', '10000000000000000000', '0')
      const minCollateral = await tester.getMinCollateral('100000000000')
      expect(minCollateral).to.be.eq(90000000)
    })
  })

  describe('getPositionValue', () => {
    describe('ETH price becomes high', () => {
      it('1 long sqeeth', async function () {
        await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(21000000)
      })

      it('1 short sqeeth', async function () {
        await tester.testUpdatePosition(0, '-100000000', '-1000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(-21000000)
      })

      it('1 long future', async function () {
        await tester.testUpdatePosition(1, '100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short future', async function () {
        await tester.testUpdatePosition(1, '-100000000', '-10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(-100000000)
      })

      it('1 long sqeeth and 0.2 short future', async function () {
        await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
        await tester.testUpdatePosition(1, '-20000000', '-2000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short sqeeth and 1 long future', async function () {
        await tester.testUpdatePosition(0, '-100000000', '-1000000000000000000', '0')
        await tester.testUpdatePosition(1, '-100000000', '10000000000000000000', '0')

        const positionValue = await tester.getPositionValue({
          markPrice0: '12100000000',
          markPrice1: '110000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        })
        expect(positionValue).to.be.eq(-2121000000)
      })
    })
  })

  describe('depositOtWithdraw', () => {
    it('more collateral required', async function () {
      await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
      await tester.testDepositOrWithdraw('100000000', '100000000000', {
        markPrice0: '10000000000',
        markPrice1: '100000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
      expect(await tester.r()).to.be.eq(15000000)
      expect((await tester.traderPosition()).usdcPosition).to.be.eq(15000000)
    })

    it('there is excess collateral', async function () {
      await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
      await tester.testDepositOrWithdraw('100000000', '100000000000', {
        markPrice0: '10000000000',
        markPrice1: '100000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
      await tester.testDepositOrWithdraw('100000000', '110000000000', {
        markPrice0: '12100000000',
        markPrice1: '110000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
      expect(await tester.r()).to.be.eq(-17850000)
      expect((await tester.traderPosition()).usdcPosition).to.be.eq(-2850000)
    })
  })

  describe('liquidate', () => {
    beforeEach(async () => {
      await tester.testUpdatePosition(0, '100000000', '1000000000000000000', '0')
      await tester.testDepositOrWithdraw('100000000', '100000000000', {
        markPrice0: '10000000000',
        markPrice1: '100000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
    })

    it('reverts if position value is greater than min collateral', async function () {
      await expect(
        tester.testLiquidate('100000000000', {
          markPrice0: '10000000000',
          markPrice1: '100000000000',
          cumFundingFeePerSizeGlobal0: 0,
          cumFundingFeePerSizeGlobal1: 0,
        }),
      ).to.be.revertedWith('T1')

      expect((await tester.traderPosition()).usdcPosition).to.be.eq(15000000)
    })

    it('liquidate a vault', async function () {
      await tester.testLiquidate('95000000000', {
        markPrice0: '9025000000',
        markPrice1: '95000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
      expect((await tester.traderPosition()).usdcPosition).to.be.eq(12375000)
    })

    it('vault is insolvency', async function () {
      await tester.testLiquidate('90000000000', {
        markPrice0: '8100000000',
        markPrice1: '90000000000',
        cumFundingFeePerSizeGlobal0: 0,
        cumFundingFeePerSizeGlobal1: 0,
      })
      const traderPosition = await tester.traderPosition()
      expect(traderPosition.usdcPosition).to.be.eq(15000000)
      expect(traderPosition.isInsolvent).to.be.eq(true)
    })

    it('position value is decreased by funding fee', async function () {
      await tester.testLiquidate('100000000000', {
        markPrice0: '10000000000',
        markPrice1: '100000000000',
        cumFundingFeePerSizeGlobal0: 100,
        cumFundingFeePerSizeGlobal1: 100,
      })
      expect((await tester.traderPosition()).usdcPosition).to.be.eq(7500001)
    })
  })
})
