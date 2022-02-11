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
import { scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, MAX_WITHDRAW_AMOUNT, SQUEETH_PRODUCT_ID } from './utils/constants'
import { LPToken } from '../typechain/LPToken'

describe('trade', function () {
  let wallet: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket
  let lpToken: LPToken

  const MaxInt128 = ethers.constants.MaxUint256

  before(async () => {
    ;[wallet] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
    lpToken = testContractSet.lpToken
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
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(2, 8)],
          marginAmount: scaledBN(200, 6),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await testContractHelper.updateSpot(scaledBN(950, 8))

        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-2, 8)],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('withdraw all and check balance of PerpetualMarket', async () => {
        const tokenAmount = await lpToken.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(200000, 6))

        expect(
          (await usdc.balanceOf(perpetualMarket.address)).sub(await perpetualMarket.cumulativeProtocolFee()),
        ).to.eq(0)
        expect(await lpToken.balanceOf(wallet.address)).to.eq(0)
      })
    })

    describe('large amount of trade', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 12)],
          marginAmount: scaledBN(15000000, 6),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await testContractHelper.updateSpot(scaledBN(950, 8))

        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 12)],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('withdraw all and check balance of PerPetualMarket', async () => {
        const tokenAmount = await lpToken.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(50000000, 6))

        expect(
          (await usdc.balanceOf(perpetualMarket.address)).sub(await perpetualMarket.cumulativeProtocolFee()),
        ).to.eq(0)
        expect(await lpToken.balanceOf(wallet.address)).to.eq(0)
      })
    })
  })

  describe('getTradePrice', () => {
    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(1200, 8))
      await perpetualMarket.initialize(scaledBN(50000000, 6), scaledBN(3, 5))
    })

    it('get trade price of squared perpetual', async () => {
      const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, 100)

      expect(tradePrice.tradePrice).to.be.eq(14457600000)
      expect(tradePrice.indexPrice).to.be.eq(14400000000)
      expect(tradePrice.fundingFee).to.be.eq(43200000)
      expect(tradePrice.tradeFee).to.be.eq(14400000)
      expect(tradePrice.protocolFee).to.be.eq(5760000)
      expect(tradePrice.fundingRate).to.be.eq(300000)
      expect(tradePrice.totalValue).to.be.eq(14457)
      expect(tradePrice.totalFee).to.be.eq(14)
    })

    it('get trade price of perpetual future', async () => {
      const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, 100)

      expect(tradePrice.tradePrice).to.be.eq(120120000000)
      expect(tradePrice.indexPrice).to.be.eq(120000000000)
      expect(tradePrice.fundingFee).to.be.eq(0)
      expect(tradePrice.tradeFee).to.be.eq(120000000)
      expect(tradePrice.protocolFee).to.be.eq(48000000)
      expect(tradePrice.fundingRate).to.be.eq(0)
      expect(tradePrice.totalValue).to.be.eq(120120)
      expect(tradePrice.totalFee).to.be.eq(120)
    })

    describe('position increased', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        await perpetualMarket.trade({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(2, 8)],
          marginAmount: scaledBN(2000, 6),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('get trade price of small position', async () => {
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

      it("get squared perpetual's trade price of large position", async () => {
        const tradePrice = await perpetualMarket.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 12))

        expect(tradePrice.tradePrice).to.be.eq(10040588000)
        expect(tradePrice.indexPrice).to.be.eq(10000000000)
        expect(tradePrice.fundingFee).to.be.eq(30588000)
        expect(tradePrice.tradeFee).to.be.eq(10000000)
        expect(tradePrice.protocolFee).to.be.eq(4000000)
        expect(tradePrice.fundingRate).to.be.eq(305880)
        expect(tradePrice.totalValue).to.be.eq(100405880000000)
        expect(tradePrice.totalFee).to.be.eq(100000000000)
      })

      it("get perpetual future's trade price of large position", async () => {
        const tradePrice = await perpetualMarket.getTradePrice(FUTURE_PRODUCT_ID, scaledBN(1, 12))

        expect(tradePrice.tradePrice).to.be.eq(100102801000)
        expect(tradePrice.indexPrice).to.be.eq(100000000000)
        expect(tradePrice.fundingFee).to.be.eq(2801000)
        expect(tradePrice.tradeFee).to.be.eq(100000000)
        expect(tradePrice.protocolFee).to.be.eq(40000000)
        expect(tradePrice.fundingRate).to.be.eq(2801)
        expect(tradePrice.totalValue).to.be.eq(1001028010000000)
        expect(tradePrice.totalFee).to.be.eq(1000000000000)
      })
    })
  })
})
