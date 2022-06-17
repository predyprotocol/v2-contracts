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
  SAFETY_BLOCK_PERIOD,
  SQUEETH_PRODUCT_ID,
} from './utils/constants'
import { MockArbSys } from '../typechain/MockArbSys'

describe('trade', function () {
  this.timeout(60000)
  let wallet: Wallet
  let weth: MockERC20
  let usdc: MockERC20
  let arbSys: MockArbSys

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxInt128 = ethers.constants.MaxUint256

  async function increaseBlockNumber(blocknumber: number) {
    const currentBlockNumber = await arbSys.arbBlockNumber()
    await arbSys.setBlockNumber(currentBlockNumber.add(blocknumber))
  }

  async function execHedge(withRebalance: boolean) {
    const amounts = await perpetualMarket.getTokenAmountForHedging()
    await perpetualMarket.execHedge(withRebalance, amounts[1])
  }

  before(async () => {
    ;[wallet] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
    arbSys = testContractSet.arbSys
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
    const vaultMargin = BigNumber.from(MIN_MARGIN).mul(5000)

    beforeEach(async () => {
      await perpetualMarket.initialize(depositAmount, 100000)
    })

    describe('payoff check', () => {
      const initialSpotPrice = 1000

      async function checkPayoff(tradeAmounts: number[], spotPrice: number, vaultId: number, subVaultIndex: number) {
        await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

        const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))
        await openPosition(tradeAmounts, vaultId, subVaultIndex)

        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

        // Close position and check payoff
        const before = await usdc.balanceOf(wallet.address)
        await closePosition(spotPrice, vaultId, subVaultIndex)
        const after = await usdc.balanceOf(wallet.address)
        const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(depositAmount.mul(-1))

        const expectedPayoff = getExpectedPayout(tradeAmounts, spotPrice)
        const vaultProfit = after.sub(before).sub(vaultMargin)
        const lpProfit = afterLPTokenPrice.sub(beforeLPTokenPrice).mul(depositAmount).div(scaledBN(1, 16))

        // Assert trader's profit and loss
        assertCloseToPercentage(vaultProfit, numToBn(expectedPayoff.profit, 6), BigNumber.from(1000000))

        // Assert LP's profit and loss
        assertCloseToPercentage(
          lpProfit,
          numToBn(-expectedPayoff.profit - expectedPayoff.protocolFee, 6),
          BigNumber.from(1000000),
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

        const vaultFundingReceived = after.sub(before).sub(vaultMargin).sub(numToBn(expectedPayoff.profit, 6))
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
        const protocolFeeRate = 0.2
        const tradeFeeFuture = 2 * tradeFeeRate * Math.abs(tradeAmounts[0]) * initialSpotPrice
        const tradeFeeSquared = (4 * tradeFeeRate * Math.abs(tradeAmounts[1]) * initialSpotPrice ** 2) / 10000
        const tradeFee = tradeFeeFuture + tradeFeeSquared
        let expectedProfit = expectedPayoffOfFuture + expectedPayoffOfSquared - tradeFee
        const expectedProtocolFee = protocolFeeRate * tradeFee

        expectedProfit = Math.floor(expectedProfit * 100) / 100

        return {
          profit: expectedProfit,
          protocolFee: expectedProtocolFee,
        }
      }

      async function openPosition(tradeSmounts: number[], vaultId: number, subVaultIndex: number) {
        await testContractHelper.trade(
          wallet,
          vaultId,
          [numToBn(tradeSmounts[0], 8), numToBn(tradeSmounts[1], 8)],
          vaultMargin,
          subVaultIndex,
        )
      }

      async function closePosition(spotPrice: number, vaultId: number, subVaultIndex: number) {
        const traderVault = await perpetualMarket.getTraderVault(vaultId)

        await testContractHelper.updateSpot(numToBn(spotPrice, 8))

        await testContractHelper.trade(
          wallet,
          vaultId,
          [
            traderVault.subVaults[subVaultIndex].positionPerpetuals[0].mul(-1),
            traderVault.subVaults[subVaultIndex].positionPerpetuals[1].mul(-1),
          ],
          MAX_WITHDRAW_AMOUNT,
          subVaultIndex,
        )

        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)
      }

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))
        await testContractHelper.trade(wallet, 0, [numToBn(1, 8), 0], MIN_MARGIN)
        await testContractHelper.trade(wallet, 1, [numToBn(-1, 8), 0], MAX_WITHDRAW_AMOUNT)
      })

      it('trader and LP gets correct payoff', async () => {
        const testDataSet = [
          { tradeAmounts: [10, 0], spotPrice: 1000 },
          { tradeAmounts: [0, 10], spotPrice: 1000 },
          { tradeAmounts: [10, 0], spotPrice: 1100 },
          { tradeAmounts: [0, 10], spotPrice: 1100 },
          { tradeAmounts: [10, 0], spotPrice: 900 },
          { tradeAmounts: [0, 10], spotPrice: 900 },
          { tradeAmounts: [-10, 0], spotPrice: 900 },
          { tradeAmounts: [-10, 0], spotPrice: 1100 },
          { tradeAmounts: [0, -20], spotPrice: 900 },
          { tradeAmounts: [0, -20], spotPrice: 1100 },
          { tradeAmounts: [10, -20], spotPrice: 1100 },
          { tradeAmounts: [10, -20], spotPrice: 900 },
          { tradeAmounts: [-10, 20], spotPrice: 1100 },
          { tradeAmounts: [-10, 20], spotPrice: 900 },
        ]

        for (let testData of testDataSet) {
          await checkPayoff(testData.tradeAmounts, testData.spotPrice, 1, 0)
        }
      })

      it('trader and LP gets correct payoff(multiple subVaults)', async () => {
        const testDataSet = [
          { tradeAmounts: [10, 0], spotPrice: 1000 },
          { tradeAmounts: [0, 10], spotPrice: 1000 },
          { tradeAmounts: [10, 0], spotPrice: 1100 },
          { tradeAmounts: [0, 10], spotPrice: 1100 },
          { tradeAmounts: [10, 0], spotPrice: 900 },
          { tradeAmounts: [0, 10], spotPrice: 900 },
          { tradeAmounts: [-10, 0], spotPrice: 900 },
          { tradeAmounts: [-10, 0], spotPrice: 1100 },
          { tradeAmounts: [0, -20], spotPrice: 900 },
          { tradeAmounts: [0, -20], spotPrice: 1100 },
          { tradeAmounts: [10, -20], spotPrice: 1100 },
          { tradeAmounts: [10, -20], spotPrice: 900 },
          { tradeAmounts: [-10, 20], spotPrice: 1100 },
          { tradeAmounts: [-10, 20], spotPrice: 900 },
        ]

        let subVaultIndex = 0

        for (let testData of testDataSet) {
          await checkPayoff(testData.tradeAmounts, testData.spotPrice, 1, subVaultIndex++)
        }
      })

      it('trader and LP gets correct funding received', async () => {
        const testDataSet = [
          { tradeAmounts: [100, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, 2], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [-100, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, -2], spotPrice: 1000, isPoolReceived: false, isTraderReceived: true },
          // squared perp's funding rate becomes negative
          { tradeAmounts: [0, -120000], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
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
        await testContractHelper.trade(wallet, 1, [numToBn(100, 8), 0], scaledBN(20000, 6))
        await testContractHelper.trade(wallet, 0, [numToBn(1, 8), 0], MIN_MARGIN)
        await testContractHelper.trade(wallet, 2, [numToBn(-1, 8), 0], MAX_WITHDRAW_AMOUNT)

        const testDataSet = [
          { tradeAmounts: [2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [0, 2], spotPrice: 1000, isPoolReceived: true, isTraderReceived: false },
          { tradeAmounts: [-2, 0], spotPrice: 1000, isPoolReceived: true, isTraderReceived: true },
          { tradeAmounts: [0, -10], spotPrice: 1000, isPoolReceived: false, isTraderReceived: true },
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
      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        await testContractHelper.trade(wallet, 0, [scaledBN(1, 12), 0], scaledBN(15000000, 6))

        await testContractHelper.updateSpot(scaledBN(950, 8))

        await testContractHelper.trade(wallet, 1, [scaledBN(-1, 12), 0], MAX_WITHDRAW_AMOUNT)
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
      const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, [0, 100])

      expect(tradePrice.tradePrice).to.be.eq(10040000000)
      expect(tradePrice.indexPrice).to.be.eq(10000000000)
      expect(tradePrice.fundingFee).to.be.eq(30000000)
      expect(tradePrice.tradeFee).to.be.eq(10000000)
      expect(tradePrice.protocolFee).to.be.eq(2000000)
      expect(tradePrice.fundingRate).to.be.eq(30000000594000)
      expect(tradePrice.totalValue).to.be.eq(10040)
      expect(tradePrice.totalFee).to.be.eq(10)
    })

    it('get trade price of perpetual future', async () => {
      const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [100, 0])

      expect(tradePrice.tradePrice).to.be.eq(100050000001)
      expect(tradePrice.indexPrice).to.be.eq(100000000000)
      expect(tradePrice.fundingFee).to.be.eq(3)
      expect(tradePrice.tradeFee).to.be.eq(50000000)
      expect(tradePrice.protocolFee).to.be.eq(10000000)
      expect(tradePrice.fundingRate).to.be.eq(396000)
      expect(tradePrice.totalValue).to.be.eq(100050)
      expect(tradePrice.totalFee).to.be.eq(50)
    })

    it('reverts if trade amount is too large', async () => {
      await testContractHelper.updateSpot(scaledBN(3567, 8))
      await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, [0, scaledBN(100000, 8)])).to.be.revertedWith(
        'PMC1',
      )
    })

    describe('pool has short position', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), scaledBN(1, 8)], scaledBN(2000, 6))
      })

      it('reverts if trade amount is too small', async () => {
        await testContractHelper.updateSpot(scaledBN(3567, 8))
        await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, [0, scaledBN(-100000, 8)])).to.be.revertedWith(
          'PMC1',
        )
      })

      it('check trade price', async () => {
        const tradePrice1 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(-1, 8), 0])
        const tradePrice2 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(-2, 8), 0])
        const tradePrice3 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(-3, 8), 0])
        const tradePrice5 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(-5, 8), 0])

        expect(tradePrice1.fundingRate).to.be.gt(tradePrice2.fundingRate)
        expect(tradePrice2.fundingRate).to.be.gt(tradePrice3.fundingRate)
        expect(tradePrice3.fundingRate).to.be.gt(tradePrice5.fundingRate)
        expect(tradePrice5.fundingRate).to.be.lt(0)
      })
    })

    describe('pool has long position', () => {
      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))
        await testContractHelper.trade(wallet, 0, [scaledBN(-2, 8), scaledBN(-1, 8)], scaledBN(2000, 6))
      })

      it('reverts if trade amount is too large', async () => {
        await testContractHelper.updateSpot(scaledBN(3567, 8))
        await expect(perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, [0, scaledBN(100000, 8)])).to.be.revertedWith(
          'PMC1',
        )
      })

      it('check trade price', async () => {
        const tradePrice1 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(1, 8), 0])
        const tradePrice2 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(2, 8), 0])
        const tradePrice3 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(3, 8), 0])
        const tradePrice5 = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(5, 8), 0])

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
        beforeEach(async () => {
          await testContractHelper.updateSpot(scaledBN(1000, 8))

          await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), scaledBN(1, 8)], scaledBN(2000, 6))
        })

        it("get squared perpetual's trade price of large position", async () => {
          const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, [0, scaledBN(3, 12)])

          expect(tradePrice.tradePrice).to.be.eq(10044426093)
          expect(tradePrice.indexPrice).to.be.eq(10000000000)
          expect(tradePrice.fundingFee).to.be.eq(39149899)
          expect(tradePrice.tradeFee).to.be.eq(10000000)
          expect(tradePrice.protocolFee).to.be.eq(2000000)
          expect(tradePrice.fundingRate).to.be.eq(39149899393595)
          expect(tradePrice.totalValue).to.be.eq(301332782790000)
          expect(tradePrice.totalFee).to.be.eq(300000000000)
        })

        it("get perpetual future's trade price of large position", async () => {
          const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(2, 12), 0])

          expect(tradePrice.tradePrice).to.be.eq(100070102663)
          expect(tradePrice.indexPrice).to.be.eq(100000000000)
          expect(tradePrice.fundingFee).to.be.eq(48719446)
          expect(tradePrice.tradeFee).to.be.eq(50000000)
          expect(tradePrice.protocolFee).to.be.eq(10000000)
          expect(tradePrice.fundingRate).to.be.eq(4871944622559)
          expect(tradePrice.totalValue).to.be.eq(2001402053260000)
          expect(tradePrice.totalFee).to.be.eq(1000000000000)
        })
      })
    })

    describe('after hedging', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), scaledBN(1, 8)], scaledBN(2000, 6))
        await execHedge(true)
      })

      it('check trade price', async () => {
        for (let i = 0; i < 30; i++) {
          const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [scaledBN(-2, 7).mul(i), 0])
          console.log(tradePrice.fundingRate.toString())
        }
      })

      it('rebalance', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-19, 7), 0], 0)

        const beforeTradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [0, 0])

        await execHedge(true)

        const afterTradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [0, 0])

        expect(beforeTradePrice.fundingRate.gt(afterTradePrice.fundingRate)).to.be.true
      })

      it('pool position becomes long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-3, 8), 0], 0)

        const beforeTradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [0, 0])

        // locked liquidity of future pool becomes large
        await execHedge(true)

        const afterTradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, [0, 0])

        expect(beforeTradePrice.fundingRate.gt(afterTradePrice.fundingRate)).to.be.true
      })
    })
  })
})
