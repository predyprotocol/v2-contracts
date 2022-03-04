import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../typechain'
import { Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, MAX_WITHDRAW_AMOUNT, MIN_MARGIN, SQUEETH_PRODUCT_ID } from './utils/constants'

describe('trade', function () {
  let wallet: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxInt128 = ethers.constants.MaxUint256

  before(async () => {
    ;[wallet] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    await weth.mint(wallet.address, MaxInt128)
    await usdc.mint(wallet.address, MaxInt128)

    // approve
    await weth.approve(perpetualMarket.address, MaxInt128)
    await usdc.approve(perpetualMarket.address, MaxInt128)

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('trade', () => {
    beforeEach(async () => {
      await perpetualMarket.initialize(scaledBN(50000000, 6), scaledBN(2, 5))
    })

    describe('tokenPrice becomes high', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        await perpetualMarket.trade({
          vaultId: 0,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(2, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MIN_MARGIN,
          deadline: 0,
        })

        await testContractHelper.updateSpot(scaledBN(950, 8))

        await perpetualMarket.trade({
          vaultId: 1,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(-2, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })
      })

      it('withdraw all and check balance of PerpetualMarket', async () => {
        const tokenAmount = await testContractSet.perpetualMarketCore.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(200000, 6))

        expect(await usdc.balanceOf(perpetualMarket.address)).to.eq(0)
        expect(await testContractSet.perpetualMarketCore.balanceOf(wallet.address)).to.eq(0)
      })
    })

    describe('large amount of trade', () => {
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        await perpetualMarket.trade({
          vaultId: 0,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(1, 12),
              limitPrice: 0,
            },
          ],
          marginAmount: scaledBN(15000000, 6),
          deadline: 0,
        })

        await testContractHelper.updateSpot(scaledBN(950, 8))

        await perpetualMarket.trade({
          vaultId: 1,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(-1, 12),
              limitPrice: 0,
            },
          ],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })
      })

      it('withdraw all and check balance of PerPetualMarket', async () => {
        const tokenAmount = await testContractSet.perpetualMarketCore.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(50000000, 6))

        expect(await usdc.balanceOf(perpetualMarket.address)).to.eq(0)
        expect(await testContractSet.perpetualMarketCore.balanceOf(wallet.address)).to.eq(0)
      })
    })
  })

  describe('getTradePrice', () => {
    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(1000, 8))
      await perpetualMarket.initialize(scaledBN(20000, 6), scaledBN(3, 5))
    })

    it('get trade price of squared perpetual', async () => {
      const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, 100)

      expect(tradePrice.tradePrice).to.be.eq(10040000000)
      expect(tradePrice.indexPrice).to.be.eq(10000000000)
      expect(tradePrice.fundingFee).to.be.eq(30000000)
      expect(tradePrice.tradeFee).to.be.eq(10000000)
      expect(tradePrice.protocolFee).to.be.eq(4000000)
      expect(tradePrice.fundingRate).to.be.eq(300000)
      expect(tradePrice.totalValue).to.be.eq(10040)
      expect(tradePrice.totalFee).to.be.eq(10)
    })

    it('get trade price of perpetual future', async () => {
      const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, 100)

      expect(tradePrice.tradePrice).to.be.eq(100050000000)
      expect(tradePrice.indexPrice).to.be.eq(100000000000)
      expect(tradePrice.fundingFee).to.be.eq(0)
      expect(tradePrice.tradeFee).to.be.eq(50000000)
      expect(tradePrice.protocolFee).to.be.eq(20000000)
      expect(tradePrice.fundingRate).to.be.eq(0)
      expect(tradePrice.totalValue).to.be.eq(100050)
      expect(tradePrice.totalFee).to.be.eq(50)
    })

    it('reverts if trade amount is too large', async () => {
      await testContractHelper.updateSpot(scaledBN(3567, 8))
      await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(100000, 8))).to.be.revertedWith('PMC1')
    })

    describe('pool has short position', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await perpetualMarket.trade({
          vaultId,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(2, 8),
              limitPrice: 0,
            },
            {
              productId: SQUEETH_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: scaledBN(2000, 6),
          deadline: 0,
        })
      })

      it('reverts if trade amount is too small', async () => {
        await testContractHelper.updateSpot(scaledBN(3567, 8))
        await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(-100000, 8))).to.be.revertedWith('PMC1')
      })

      it('check trade price', async () => {
        const tradePrice1 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(-1, 8))
        const tradePrice2 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(-2, 8))
        const tradePrice3 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(-3, 8))
        const tradePrice5 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(-5, 8))

        expect(tradePrice1.fundingRate).to.be.gt(tradePrice2.fundingRate)
        expect(tradePrice2.fundingRate).to.be.gt(tradePrice3.fundingRate)
        expect(tradePrice3.fundingRate).to.be.gt(tradePrice5.fundingRate)
        expect(tradePrice5.fundingRate).to.be.lt(0)
      })
    })

    describe('pool has long position', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))
        await perpetualMarket.trade({
          vaultId,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(-2, 8),
              limitPrice: 0,
            },
            {
              productId: SQUEETH_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: scaledBN(-1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: scaledBN(2000, 6),
          deadline: 0,
        })
      })

      it('reverts if trade amount is too large', async () => {
        await testContractHelper.updateSpot(scaledBN(3567, 8))
        await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(100000, 8))).to.be.revertedWith('PMC1')
      })

      it('check trade price', async () => {
        const tradePrice1 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(1, 8))
        const tradePrice2 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(2, 8))
        const tradePrice3 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(3, 8))
        const tradePrice5 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(5, 8))

        expect(tradePrice1.fundingRate).to.be.lt(tradePrice2.fundingRate)
        expect(tradePrice2.fundingRate).to.be.lt(tradePrice3.fundingRate)
        expect(tradePrice3.fundingRate).to.be.lt(tradePrice5.fundingRate)
        expect(tradePrice5.fundingRate).to.be.gt(0)
      })
    })

    describe('large amount of liquidity', () => {
      beforeEach(async () => {
        await perpetualMarket.deposit(scaledBN(50000000 - 20000, 6))
      })

      describe('position increased', () => {
        const vaultId = 0
        const subVaultIndex = 0

        beforeEach(async () => {
          await testContractHelper.updateSpot(scaledBN(1000, 8))

          await perpetualMarket.trade({
            vaultId,
            trades: [
              {
                productId: FUTURE_PRODUCT_ID,
                subVaultIndex,
                tradeAmount: scaledBN(2, 8),
                limitPrice: 0,
              },
              {
                productId: SQUEETH_PRODUCT_ID,
                subVaultIndex,
                tradeAmount: scaledBN(1, 8),
                limitPrice: 0,
              },
            ],
            marginAmount: scaledBN(2000, 6),
            deadline: 0,
          })
        })

        it("get squared perpetual's trade price of large position", async () => {
          const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 12))

          expect(tradePrice.tradePrice).to.be.eq(10040588100)
          expect(tradePrice.indexPrice).to.be.eq(10000000000)
          expect(tradePrice.fundingFee).to.be.eq(30588100)
          expect(tradePrice.tradeFee).to.be.eq(10000000)
          expect(tradePrice.protocolFee).to.be.eq(4000000)
          expect(tradePrice.fundingRate).to.be.eq(305881)
          expect(tradePrice.totalValue).to.be.eq(100405881000000)
          expect(tradePrice.totalFee).to.be.eq(100000000000)
        })

        it("get perpetual future's trade price of large position", async () => {
          const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(1, 12))

          expect(tradePrice.tradePrice).to.be.eq(100052801000)
          expect(tradePrice.indexPrice).to.be.eq(100000000000)
          expect(tradePrice.fundingFee).to.be.eq(2801000)
          expect(tradePrice.tradeFee).to.be.eq(50000000)
          expect(tradePrice.protocolFee).to.be.eq(20000000)
          expect(tradePrice.fundingRate).to.be.eq(2801)
          expect(tradePrice.totalValue).to.be.eq(1000528010000000)
          expect(tradePrice.totalFee).to.be.eq(500000000000)
        })
      })
    })
  })
})
