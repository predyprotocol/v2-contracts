import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { assertCloseToPercentage, increaseTime, numToBn, scaledBN } from './utils/helpers'
import {
  FUNDING_PERIOD,
  FUTURE_PRODUCT_ID,
  MAX_WITHDRAW_AMOUNT,
  MIN_MARGIN,
  SAFETY_PERIOD,
  SQUEETH_PRODUCT_ID,
} from './utils/constants'

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
    const depositAmount = scaledBN(50000000, 6)

    beforeEach(async () => {
      await perpetualMarket.initialize(depositAmount, 100000)
    })

    describe('payoff check', () => {
      const initialSpotPrice = 1000

      async function checkPayoff(tradeAmounts: number[], spotPrice: number, vaultId: number, subVaultIndex: number) {
        await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

        const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))
        await openPosition(tradeAmounts, vaultId, subVaultIndex)

        await increaseTime(SAFETY_PERIOD)

        // Close position and check payoff
        const before = await usdc.balanceOf(wallet.address)
        await closePosition(spotPrice, vaultId, subVaultIndex)
        const after = await usdc.balanceOf(wallet.address)
        const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))

        const expectedPayoff = getExpectedPayout(tradeAmounts, spotPrice)
        const vaultProfit = after.sub(before).sub(MIN_MARGIN)
        const lpProfit = afterLPTokenPrice.sub(beforeLPTokenPrice).mul(depositAmount).div(scaledBN(1, 16))

        // Assert trader's profit and loss
        assertCloseToPercentage(vaultProfit, numToBn(expectedPayoff.profit, 6), BigNumber.from(500000))

        // Assert LP's profit and loss
        assertCloseToPercentage(
          lpProfit,
          numToBn(-expectedPayoff.profit - expectedPayoff.protocolFee, 6),
          BigNumber.from(500000),
        )

        // Check the vault has no positions
        const traderVault = await perpetualMarket.getTraderVault(vaultId)
        expect(traderVault.positionUsdc).to.be.eq(0)
        expect(traderVault.subVaults[0].positionPerpetuals[0]).to.be.eq(0)
        expect(traderVault.subVaults[0].positionPerpetuals[1]).to.be.eq(0)
      }

      async function checkFundingPayment(
        tradeAmounts: number[],
        spotPrice: number,
        isPoolReceived: boolean,
        isTraderReceived: boolean,
        vaultId: number,
        subVaultIndex: number,
      ) {
        await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

        const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))
        await openPosition(tradeAmounts, vaultId, subVaultIndex)

        await increaseTime(FUNDING_PERIOD * 100)

        // Close position and check payoff
        const before = await usdc.balanceOf(wallet.address)
        await closePosition(spotPrice, vaultId, subVaultIndex)
        const after = await usdc.balanceOf(wallet.address)
        const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))

        const expectedPayoff = getExpectedPayout(tradeAmounts, spotPrice)

        const vaultFundingReceived = after.sub(before).sub(MIN_MARGIN).sub(numToBn(expectedPayoff.profit, 6))
        const lpFundingFundingReceived = afterLPTokenPrice
          .sub(beforeLPTokenPrice)
          .mul(depositAmount)
          .div(scaledBN(1, 16))
          .add(numToBn(expectedPayoff.profit, 6))
          .add(numToBn(expectedPayoff.protocolFee, 6))

        if (isPoolReceived) {
          expect(lpFundingFundingReceived).to.be.gt(0)
        } else {
          expect(lpFundingFundingReceived).to.be.lt(0)
        }

        if (isTraderReceived) {
          expect(vaultFundingReceived).to.be.gt(0)
        } else {
          expect(vaultFundingReceived).to.be.lt(0)
        }

        // Check the vault has no positions
        const traderVault = await perpetualMarket.getTraderVault(vaultId)
        expect(traderVault.positionUsdc).to.be.eq(0)
        expect(traderVault.subVaults[0].positionPerpetuals[0]).to.be.eq(0)
        expect(traderVault.subVaults[0].positionPerpetuals[1]).to.be.eq(0)
      }

      function getExpectedPayout(tradeAmounts: number[], spotPrice: number) {
        const expectedPayoffOfFuture = tradeAmounts[0] * (spotPrice - initialSpotPrice)
        const expectedPayoffOfSquared = (tradeAmounts[1] * (spotPrice ** 2 - initialSpotPrice ** 2)) / 10000
        const tradeFeeRate = 0.0005
        const protocolFeeRate = 0.4
        const tradeFeeFuture = 2 * tradeFeeRate * Math.abs(tradeAmounts[0]) * initialSpotPrice
        const tradeFeeSquared = (4 * tradeFeeRate * Math.abs(tradeAmounts[1]) * initialSpotPrice ** 2) / 10000
        const tradeFee = tradeFeeFuture + tradeFeeSquared
        const expectedProfit = expectedPayoffOfFuture + expectedPayoffOfSquared - tradeFee
        const expectedProtocolFee = protocolFeeRate * tradeFee

        return {
          profit: expectedProfit,
          protocolFee: expectedProtocolFee,
        }
      }

      async function openPosition(tradeSmounts: number[], vaultId: number, subVaultIndex: number) {
        await perpetualMarket.trade({
          vaultId,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: numToBn(tradeSmounts[0], 8),
              limitPrice: 0,
            },
            {
              productId: SQUEETH_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: numToBn(tradeSmounts[1], 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MIN_MARGIN,
          deadline: 0,
        })
      }

      async function closePosition(spotPrice: number, vaultId: number, subVaultIndex: number) {
        const traderVault = await perpetualMarket.getTraderVault(vaultId)

        await testContractHelper.updateSpot(numToBn(spotPrice, 8))

        await perpetualMarket.trade({
          vaultId,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: traderVault.subVaults[subVaultIndex].positionPerpetuals[0].mul(-1),
              limitPrice: 0,
            },
            {
              productId: SQUEETH_PRODUCT_ID,
              subVaultIndex,
              tradeAmount: traderVault.subVaults[subVaultIndex].positionPerpetuals[1].mul(-1),
              limitPrice: 0,
            },
          ],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })
        await increaseTime(SAFETY_PERIOD)
      }

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))
        await perpetualMarket.trade({
          vaultId: 0,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex: 0,
              tradeAmount: numToBn(1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MIN_MARGIN,
          deadline: 0,
        })
        await perpetualMarket.trade({
          vaultId: 1,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex: 0,
              tradeAmount: numToBn(-1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })
      })

      it('trader and LP gets correct payoff', async () => {
        const testDataSet = [
          { tradeAmounts: [1, 0], spotPrice: 1000 },
          { tradeAmounts: [0, 1], spotPrice: 1000 },
          { tradeAmounts: [1, 0], spotPrice: 1100 },
          { tradeAmounts: [0, 1], spotPrice: 1100 },
          { tradeAmounts: [1, 0], spotPrice: 900 },
          { tradeAmounts: [0, 1], spotPrice: 900 },
          { tradeAmounts: [-1, 0], spotPrice: 900 },
          { tradeAmounts: [-1, 0], spotPrice: 1100 },
          { tradeAmounts: [0, -2], spotPrice: 900 },
          { tradeAmounts: [0, -2], spotPrice: 1100 },
          { tradeAmounts: [1, -2], spotPrice: 1100 },
          { tradeAmounts: [1, -2], spotPrice: 900 },
          { tradeAmounts: [-1, 2], spotPrice: 1100 },
          { tradeAmounts: [-1, 2], spotPrice: 900 },
        ]

        for (let testData of testDataSet) {
          await checkPayoff(testData.tradeAmounts, testData.spotPrice, 1, 0)
        }
      })

      it('trader and LP gets correct payoff(multiple subVaults)', async () => {
        const testDataSet = [
          { tradeAmounts: [1, 0], spotPrice: 1000 },
          { tradeAmounts: [0, 1], spotPrice: 1000 },
          { tradeAmounts: [1, 0], spotPrice: 1100 },
          { tradeAmounts: [0, 1], spotPrice: 1100 },
          { tradeAmounts: [1, 0], spotPrice: 900 },
          { tradeAmounts: [0, 1], spotPrice: 900 },
          { tradeAmounts: [-1, 0], spotPrice: 900 },
          { tradeAmounts: [-1, 0], spotPrice: 1100 },
          { tradeAmounts: [0, -2], spotPrice: 900 },
          { tradeAmounts: [0, -2], spotPrice: 1100 },
          { tradeAmounts: [1, -2], spotPrice: 1100 },
          { tradeAmounts: [1, -2], spotPrice: 900 },
          { tradeAmounts: [-1, 2], spotPrice: 1100 },
          { tradeAmounts: [-1, 2], spotPrice: 900 },
        ]

        let subVaultIndex = 0

        for (let testData of testDataSet) {
          await checkPayoff(testData.tradeAmounts, testData.spotPrice, 1, subVaultIndex++)
        }
      })

      it('trader and LP gets correct funding received', async () => {
        const testDataSet = [
          { tradeAmounts: [2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, 2], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [-2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, -2], spotPrice: 1000, isPoolReceived: false, isTraderReceived: true },
        ]

        for (let testData of testDataSet) {
          await checkFundingPayment(
            testData.tradeAmounts,
            testData.spotPrice,
            testData.isPoolReceived,
            testData.isTraderReceived,
            1,
            0,
          )
        }
      })

      it("trader and LP gets correct funding received(future's funding rate is positive)", async () => {
        await perpetualMarket.trade({
          vaultId: 1,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex: 0,
              tradeAmount: numToBn(100, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: scaledBN(20000, 6),
          deadline: 0,
        })
        await perpetualMarket.trade({
          vaultId: 0,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex: 0,
              tradeAmount: numToBn(1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MIN_MARGIN,
          deadline: 0,
        })
        await perpetualMarket.trade({
          vaultId: 2,
          trades: [
            {
              productId: FUTURE_PRODUCT_ID,
              subVaultIndex: 0,
              tradeAmount: numToBn(-1, 8),
              limitPrice: 0,
            },
          ],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })

        const testDataSet = [
          { tradeAmounts: [2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, 2], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [-2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: true },
          { tradeAmounts: [0, -2], spotPrice: 1000, isPoolReceived: false, isTraderReceived: true },
        ]

        for (let testData of testDataSet) {
          await checkFundingPayment(
            testData.tradeAmounts,
            testData.spotPrice,
            testData.isPoolReceived,
            testData.isTraderReceived,
            2,
            0,
          )
        }
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
