import { expect } from 'chai'
import { ethers } from 'hardhat'
import { FeePool, MockChainlinkAggregator, PerpetualMarketCore, PerpetualMarketCoreTester } from '../typechain'
import { BigNumber, BigNumberish, constants, Wallet } from 'ethers'
import { restoreSnapshot, takeSnapshot } from './utils/deploy'
import { assertCloseToPercentage, getBlocktime, increaseTime, numToBn, scaledBN } from './utils/helpers'
import {
  MarginChange,
  FUNDING_PERIOD,
  FUTURE_PRODUCT_ID,
  SAFETY_PERIOD,
  SQUEETH_PRODUCT_ID,
  VARIANCE_UPDATE_INTERVAL,
} from './utils/constants'

describe('PerpetualMarketCore', function () {
  let wallet: Wallet, other: Wallet

  let priceFeed: MockChainlinkAggregator
  let perpetualMarketCore: PerpetualMarketCore
  let tester: PerpetualMarketCoreTester
  let snapshotId: number

  async function updateRoundData(roundId: number, spot: BigNumberish) {
    await priceFeed.setLatestRoundData(roundId, spot)
  }

  async function updateSpot(spot: BigNumberish) {
    await updateRoundData(0, spot)
  }

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    const MockChainlinkAggregator = await ethers.getContractFactory('MockChainlinkAggregator')
    priceFeed = (await MockChainlinkAggregator.deploy()) as MockChainlinkAggregator

    const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore')
    perpetualMarketCore = (await PerpetualMarketCore.deploy(priceFeed.address, '', '')) as PerpetualMarketCore

    await perpetualMarketCore.setPerpetualMarket(wallet.address)

    const PerpetualMarketCoreTester = await ethers.getContractFactory('PerpetualMarketCoreTester')
    tester = (await PerpetualMarketCoreTester.deploy(priceFeed.address)) as PerpetualMarketCoreTester

    await tester.setPerpetualMarket(wallet.address)
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    await updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('initialize', () => {
    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(
        perpetualMarketCore.connect(other).initialize(wallet.address, 1000, scaledBN(5, 5)),
      ).to.be.revertedWith('PMC2')
    })

    it('suceed to initialize', async () => {
      await perpetualMarketCore.initialize(wallet.address, 1000, scaledBN(5, 5))

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1000)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1000)
    })
  })

  describe('deposit', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(wallet.address, 1000000, scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).deposit(wallet.address, 1000)).to.be.revertedWith('PMC2')
    })

    it('suceed to deposit', async () => {
      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(2000000)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(2000000)
    })

    it('deposits after that pool position increased', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1999830)
    })

    it('deposits after pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1998829)
    })

    it('deposits after pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(2000836)
    })
  })

  describe('withdraw', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(wallet.address, 1000000, scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).withdraw(wallet.address, 1000)).to.be.revertedWith('PMC2')
    })

    it('withdraws a half of liquidity', async () => {
      await perpetualMarketCore.withdraw(wallet.address, 500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(500000)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(500000)
    })

    it('withdraws all', async () => {
      await perpetualMarketCore.withdraw(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(0)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(0)
    })

    it('reverts withdrawal if there is little available liquidity', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await expect(perpetualMarketCore.withdraw(wallet.address, 1000000)).to.be.revertedWith('PMC0')
    })

    it('withdraws after the pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.withdraw(wallet.address, 500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(500574)
    })

    it('withdraws after the pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.withdraw(wallet.address, 500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(499570)
    })

    it('spread becomes high', async () => {
      await perpetualMarketCore.deposit(wallet.address, 1000000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.withdraw(wallet.address, 500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1500000)
    })

    it('spread returns low after time passed', async () => {
      await perpetualMarketCore.deposit(wallet.address, 1000000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await increaseTime(SAFETY_PERIOD)

      await perpetualMarketCore.withdraw(wallet.address, 500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1500290)
    })

    it('spread becomes high when withdraw', async () => {
      await perpetualMarketCore.withdraw(wallet.address, 500000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1500000)
    })

    it('spread returns low when withdraw', async () => {
      await perpetualMarketCore.withdraw(wallet.address, 500000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(1005, 8))

      await increaseTime(SAFETY_PERIOD)

      await perpetualMarketCore.deposit(wallet.address, 1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.totalSupply()).to.be.eq(1501632)
    })
  })

  describe('updatePoolPosition', () => {
    async function updatePoolPosition(productId: number, tradeAmount: BigNumberish) {
      await tester.testUpdatePoolPosition(productId, tradeAmount)
      const result = await tester.result()
      await tester.testUpdatePoolPosition(productId, BigNumber.from(tradeAmount).mul(-1))
      return result
    }

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(tester.connect(other).updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)).to.be.revertedWith('PMC2')
    })

    it('reverts if pool has no liquidity', async () => {
      await expect(tester.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)).to.be.revertedWith('PMC1')
    })

    describe('after initialized', () => {
      beforeEach(async () => {
        await tester.initialize(wallet.address, scaledBN(10, 8), scaledBN(5, 5))
      })

      it('reverts if pool has no enough liquidity', async () => {
        await expect(tester.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(100, 8))).to.be.revertedWith('PMC1')
      })

      describe('locked margin becomes 0 if all positions are closed', () => {
        it('close short positions of squared', async () => {
          await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)
          await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)

          const pool = await tester.pools(SQUEETH_PRODUCT_ID)
          expect(pool.amountLockedLiquidity).to.be.eq(0)
        })

        it('close long positions of squared', async () => {
          await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)
          await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)

          const pool = await tester.pools(SQUEETH_PRODUCT_ID)
          expect(pool.amountLockedLiquidity).to.be.eq(0)
        })

        it('close short positions of future', async () => {
          await tester.updatePoolPosition(FUTURE_PRODUCT_ID, 100000)
          await tester.updatePoolPosition(FUTURE_PRODUCT_ID, -100000)

          const pool = await tester.pools(FUTURE_PRODUCT_ID)
          expect(pool.amountLockedLiquidity).to.be.eq(0)
        })

        it('close long positions of future', async () => {
          await tester.updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
          await tester.updatePoolPosition(FUTURE_PRODUCT_ID, 100000)

          const pool = await tester.pools(FUTURE_PRODUCT_ID)
          expect(pool.amountLockedLiquidity).to.be.eq(0)
        })
      })

      it('trade price increased as squeeth position increased', async () => {
        const tradePrice1 = await updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)
        const tradePrice2 = await updatePoolPosition(SQUEETH_PRODUCT_ID, 200000)

        expect(tradePrice2).to.be.gt(tradePrice1)
      })

      it('trade price decreased as squeeth position decreased', async () => {
        const tradePrice1 = await updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)
        const tradePrice2 = await updatePoolPosition(SQUEETH_PRODUCT_ID, -200000)

        expect(tradePrice2).to.be.lt(tradePrice1)
      })

      it('trade price increased as future position increased', async () => {
        const tradePrice1 = await updatePoolPosition(FUTURE_PRODUCT_ID, 100000)
        const tradePrice2 = await updatePoolPosition(FUTURE_PRODUCT_ID, 200000)

        expect(tradePrice2).to.be.gt(tradePrice1)
      })

      it('trade price decreased as future position decreased', async () => {
        const tradePrice1 = await updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
        const tradePrice2 = await updatePoolPosition(FUTURE_PRODUCT_ID, -200000)

        expect(tradePrice2).to.be.lt(tradePrice1)
      })

      describe('pool has short position', () => {
        beforeEach(async () => {
          await updatePoolPosition(FUTURE_PRODUCT_ID, 100000)
          await updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)
        })

        it('trade price decreased as squeeth position decreased', async () => {
          const tradePrice1 = await updatePoolPosition(SQUEETH_PRODUCT_ID, -50000)
          const tradePrice2 = await updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)
          const tradePrice3 = await updatePoolPosition(SQUEETH_PRODUCT_ID, -150000)

          expect(tradePrice2).to.be.lt(tradePrice1)
          expect(tradePrice3).to.be.lt(tradePrice2)
        })

        it('trade price decreased as future position decreased', async () => {
          const tradePrice1 = await updatePoolPosition(FUTURE_PRODUCT_ID, -50000)
          const tradePrice2 = await updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
          const tradePrice3 = await updatePoolPosition(FUTURE_PRODUCT_ID, -150000)

          expect(tradePrice2).to.be.lt(tradePrice1)
          expect(tradePrice3).to.be.lt(tradePrice2)
        })
      })

      describe('pool has long position', () => {
        beforeEach(async () => {
          await updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
          await updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)
        })

        it('trade price increased as squeeth position increased', async () => {
          const tradePrice1 = await updatePoolPosition(SQUEETH_PRODUCT_ID, 50000)
          const tradePrice2 = await updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)
          const tradePrice3 = await updatePoolPosition(SQUEETH_PRODUCT_ID, 150000)

          expect(tradePrice2).to.be.gt(tradePrice1)
          expect(tradePrice3).to.be.gt(tradePrice2)
        })

        it('trade price increased as future position increased', async () => {
          const tradePrice1 = await updatePoolPosition(FUTURE_PRODUCT_ID, 50000)
          const tradePrice2 = await updatePoolPosition(FUTURE_PRODUCT_ID, 100000)
          const tradePrice3 = await updatePoolPosition(FUTURE_PRODUCT_ID, 150000)

          expect(tradePrice2).to.be.gt(tradePrice1)
          expect(tradePrice3).to.be.gt(tradePrice2)
        })
      })
    })

    describe('check utilization', () => {
      beforeEach(async () => {
        await tester.initialize(wallet.address, scaledBN(10, 8), scaledBN(5, 5))
      })

      it('utilization ratio becomes high', async () => {
        await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, 2000000)

        const utilizationRatio = await tester.getUtilizationRatio()
        expect(utilizationRatio).to.be.eq(78406272)
      })
    })
  })

  describe('updatePoolSnapshot', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(wallet.address, scaledBN(10, 8), scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).updatePoolSnapshot()).to.be.revertedWith('PMC2')
    })

    it('variance is not updated', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))
      await perpetualMarketCore.updatePoolSnapshot()
      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.eq(afterTradePrice[0])
    })

    it('variance becomes low', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1020, 8))
      await perpetualMarketCore.updatePoolSnapshot()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.gt(afterTradePrice[0])
    })

    it('variance becomes high', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1060, 8))
      await perpetualMarketCore.updatePoolSnapshot()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQUEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.lt(afterTradePrice[0])
    })
  })

  describe('getTokenAmountForHedging', () => {
    beforeEach(async () => {
      await updateSpot(scaledBN(1000, 8))
    })

    it('get token amounts with min slippage tolerance', async () => {
      await perpetualMarketCore.initialize(wallet.address, scaledBN(2000, 6), scaledBN(5, 5))

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20080000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    it('slippage tolerance becomes big price move', async () => {
      await updateSpot(scaledBN(980, 8))

      await perpetualMarketCore.initialize(wallet.address, scaledBN(2000, 6), scaledBN(5, 5))

      await updateSpot(scaledBN(1000, 8))

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20144000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    describe('delta is negative', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(wallet.address, scaledBN(2000, 6), scaledBN(5, 5))

        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(1, 5))
      })

      it('get token amounts with min slippage tolerance', async () => {
        const beforeTokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()
        await perpetualMarketCore.completeHedgingProcedure({
          amountUsdc: beforeTokenAmounts[0],
          amountUnderlying: beforeTokenAmounts[1],
          isLong: true,
          amountsRequiredUnderlying: beforeTokenAmounts.amountsRequiredUnderlying,
        })

        await updateSpot(scaledBN(1000, 8))

        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(-1, 5))

        const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

        expect(tokenAmounts.amountUsdc).to.be.eq(19920000)
        expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
      })

      it('slippage tolerance becomes big by price move', async () => {
        await updateSpot(scaledBN(980, 8))

        const beforeTokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()
        await perpetualMarketCore.completeHedgingProcedure({
          amountUsdc: beforeTokenAmounts[0],
          amountUnderlying: beforeTokenAmounts[1],
          isLong: true,
          amountsRequiredUnderlying: beforeTokenAmounts.amountsRequiredUnderlying,
        })

        await updateSpot(scaledBN(1000, 8))

        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(-1, 5))

        const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

        expect(tokenAmounts.amountUsdc).to.be.eq(19458880)
        expect(tokenAmounts.amountUnderlying).to.be.eq(19600)
      })
    })
  })

  describe('setSquaredPerpFundingMultiplier', () => {
    it('set squaredPerpFundingMultiplier', async () => {
      await expect(perpetualMarketCore.setSquaredPerpFundingMultiplier(10))
        .to.be.emit(perpetualMarketCore, 'SetSquaredPerpFundingMultiplier')
        .withArgs(10)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setSquaredPerpFundingMultiplier(10)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarketCore.setSquaredPerpFundingMultiplier(-1)).to.be.reverted
    })

    it('reverts if value is greater than 200 * 1e6', async () => {
      await expect(perpetualMarketCore.setSquaredPerpFundingMultiplier(scaledBN(200, 6).add(1))).to.be.reverted
    })
  })

  describe('setPerpFutureMaxFundingRate', () => {
    it('set perpFutureMaxFundingRate', async () => {
      await expect(perpetualMarketCore.setPerpFutureMaxFundingRate(10))
        .to.be.emit(perpetualMarketCore, 'SetPerpFutureMaxFundingRate')
        .withArgs(10)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setPerpFutureMaxFundingRate(10)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarketCore.setPerpFutureMaxFundingRate(-1)).to.be.reverted
    })

    it('reverts if value is greater than 1 * 1e6', async () => {
      await expect(perpetualMarketCore.setPerpFutureMaxFundingRate(scaledBN(1, 6).add(1))).to.be.reverted
    })
  })

  describe('setHedgeParams', () => {
    it('set hedge params', async () => {
      await expect(perpetualMarketCore.setHedgeParams(10, 20, 30))
        .to.be.emit(perpetualMarketCore, 'SetHedgeParams')
        .withArgs(10, 20, 30)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setHedgeParams(10, 20, 30)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarketCore.setHedgeParams(10, 20, -1)).to.be.reverted
    })

    it('reverts if slippageTolerance is greater than 200', async () => {
      await expect(perpetualMarketCore.setHedgeParams(10, 300, 100)).to.be.revertedWith('PMC5')
    })

    it('reverts if min is greater than max', async () => {
      await expect(perpetualMarketCore.setHedgeParams(20, 10, 100)).to.be.revertedWith('PMC5')
    })
  })

  describe('setPoolMarginRiskParam', () => {
    it('set setPoolMarginRiskParam', async () => {
      await expect(perpetualMarketCore.setPoolMarginRiskParam(10))
        .to.be.emit(perpetualMarketCore, 'SetPoolMarginRiskParam')
        .withArgs(10)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setPoolMarginRiskParam(10)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarketCore.setPoolMarginRiskParam(-1)).to.be.reverted
    })
  })

  describe('setTradeFeeRate', () => {
    it('set trade fee', async () => {
      await expect(perpetualMarketCore.setTradeFeeRate(20, 10))
        .to.be.emit(perpetualMarketCore, 'SetTradeFeeRate')
        .withArgs(20, 10)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setTradeFeeRate(20, 10)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarketCore.setTradeFeeRate(-1, -1)).to.be.reverted
    })

    it('reverts if trade fee rate is less than protocol fee rate', async () => {
      await expect(perpetualMarketCore.setTradeFeeRate(10, 20)).to.be.revertedWith('PMC5')
    })
  })

  describe('setPerpetualMarket', () => {
    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarketCore.connect(other).setPerpetualMarket(wallet.address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })
  })

  describe('testUpdateVariance', () => {
    const timestamp = 60 * 60 * 24

    it('12 hours', async () => {
      await tester.setPoolSnapshot('100000000000', '300000', timestamp)
      await updateSpot('110000000000')
      await expect(tester.testUpdateVariance(timestamp + 60 * 60 * 12))
        .to.be.emit(tester, 'VarianceUpdated')
        .withArgs(402000, '110000000000', timestamp + 60 * 60 * 12)
    })

    it('24 hours', async () => {
      await tester.setPoolSnapshot('100000000000', '300000', timestamp)
      await updateSpot('110000000000')
      await expect(tester.testUpdateVariance(timestamp + 60 * 60 * 24))
        .to.be.emit(tester, 'VarianceUpdated')
        .withArgs(342000, '110000000000', timestamp + 60 * 60 * 24)
    })

    it('36 hours', async () => {
      await tester.setPoolSnapshot('100000000000', '300000', timestamp)
      await updateSpot('110000000000')
      await expect(tester.testUpdateVariance(timestamp + 60 * 60 * 36))
        .to.be.emit(tester, 'VarianceUpdated')
        .withArgs(321999, '110000000000', timestamp + 60 * 60 * 36)
    })
  })

  describe('executeFundingPayment', () => {
    it('initialize timestamp', async () => {
      await tester.testExecuteFundingPayment(FUTURE_PRODUCT_ID, scaledBN(1000, 8))
      await tester.testExecuteFundingPayment(SQUEETH_PRODUCT_ID, scaledBN(1000, 8))

      const futurePool = await tester.pools(FUTURE_PRODUCT_ID)
      const squaredPool = await tester.pools(SQUEETH_PRODUCT_ID)

      expect(futurePool.lastFundingPaymentTime).to.be.gt(0)
      expect(squaredPool.lastFundingPaymentTime).to.be.gt(0)
    })

    it('nothing happens if last timestamp is older than now', async () => {
      const timestamp = await getBlocktime()
      await tester.setPoolStatus(FUTURE_PRODUCT_ID, 0, timestamp * 2)

      const before = await tester.amountLiquidity()
      await tester.testExecuteFundingPayment(FUNDING_PERIOD, scaledBN(1000, 8))
      const after = await tester.amountLiquidity()

      expect(before).to.be.eq(after)
    })
  })

  describe('testGetSignedMarginAmount', () => {
    beforeEach(async () => {
      await tester.initialize(wallet.address, scaledBN(10, 8), scaledBN(5, 5))
    })

    it('short', async () => {
      await tester.updatePoolPosition(FUTURE_PRODUCT_ID, 100000)
      expect(await tester.testGetSignedMarginAmount(FUTURE_PRODUCT_ID)).to.be.gt(0)
    })

    it('long', async () => {
      await tester.updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
      expect(await tester.testGetSignedMarginAmount(FUTURE_PRODUCT_ID)).to.be.lt(0)
    })
  })

  describe('calculateSignedDeltaMargin', () => {
    it('short to short', async () => {
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToShort, 10, 100)).to.be.eq(10)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToShort, -10, 100)).to.be.eq(-10)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToShort, -100, 100)).to.be.eq(-100)
    })

    it('long to long', async () => {
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToLong, 10, 100)).to.be.eq(-10)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToLong, -10, 100)).to.be.eq(10)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToLong, -100, 100)).to.be.eq(100)
    })

    it('short to long', async () => {
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToLong, 10, 100)).to.be.eq(-210)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToLong, -10, 100)).to.be.eq(-190)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.ShortToLong, -100, 100)).to.be.eq(-100)
    })

    it('long to short', async () => {
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToShort, 10, 100)).to.be.eq(210)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToShort, -10, 100)).to.be.eq(190)
      expect(await tester.testCalculateSignedDeltaMargin(MarginChange.LongToShort, -100, 100)).to.be.eq(100)
    })
  })

  describe('calculateUnlockedLiquidity', () => {
    it('lockedLiquidityAmount=100, deltaM=100, hedgePositionValue=100', async () => {
      const result = await tester.testCalculateUnlockedLiquidity(100, -100, 100)

      expect(result[0]).to.be.eq(0)
      expect(result[1]).to.be.eq(-100)
    })

    it('lockedLiquidityAmount=100, deltaM=99, hedgePositionValue=99', async () => {
      const result = await tester.testCalculateUnlockedLiquidity(100, -99, 99)

      expect(result[0]).to.be.eq(-1)
      expect(result[1]).to.be.eq(-100)
    })

    it('lockedLiquidityAmount=100, deltaM=101, hedgePositionValue=101', async () => {
      const result = await tester.testCalculateUnlockedLiquidity(100, -101, 101)

      expect(result[0]).to.be.eq(1)
      expect(result[1]).to.be.eq(-100)
    })

    it('lockedLiquidityAmount=100, deltaM=50, hedgePositionValue=98', async () => {
      const result = await tester.testCalculateUnlockedLiquidity(100, -50, 98)

      expect(result[0]).to.be.eq(-1)
      expect(result[1]).to.be.eq(-51)
    })

    it('lockedLiquidityAmount=100, deltaM=50, hedgePositionValue=102', async () => {
      const result = await tester.testCalculateUnlockedLiquidity(100, -50, 102)

      expect(result[0]).to.be.eq(1)
      expect(result[1]).to.be.eq(-49)
    })
  })

  describe('calculateResultOfFundingPayment', () => {
    const days = 2

    beforeEach(async () => {
      await updateSpot(scaledBN(1000, 8))
      await tester.initialize(wallet.address, '1000000000000', scaledBN(1, 5))
      await tester.setPoolStatus(FUTURE_PRODUCT_ID, 0, 0)
      await tester.setPoolStatus(SQUEETH_PRODUCT_ID, 0, 0)
      await tester.updatePoolPosition(FUTURE_PRODUCT_ID, 100000000)
      await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, 100000000)
    })

    it('pool receives funding fee from short perpetual future position', async () => {
      const result1 = await tester.testCalculateResultOfFundingPayment(
        FUTURE_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD,
      )
      const result2 = await tester.testCalculateResultOfFundingPayment(
        FUTURE_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD * days,
      )

      expect(result1[0]).to.be.eq(result2[0])
      expect(result1[1].mul(days)).to.be.eq(result2[1])
      expect(result1[2].mul(days)).to.be.eq(result2[2])
      expect(result1[2]).to.be.gt(0)
    })

    it('pool receives funding fee from long perpetual future position', async () => {
      await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, -200000000)
      const result = await tester.testCalculateResultOfFundingPayment(
        FUTURE_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD,
      )

      expect(result[2]).to.be.gt(0)
    })

    it('pool receives funding fee from squared perpetual position', async () => {
      const result1 = await tester.testCalculateResultOfFundingPayment(
        SQUEETH_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD,
      )
      const result2 = await tester.testCalculateResultOfFundingPayment(
        SQUEETH_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD * days,
      )

      expect(result1[0]).to.be.eq(result2[0])
      expect(result1[1].mul(days)).to.be.eq(result2[1])
      expect(result1[2].mul(days)).to.be.eq(result2[2])
      expect(result1[2]).to.be.gt(0)
    })

    it('pool pays funding fee from squared perpetual position', async () => {
      await tester.updatePoolPosition(SQUEETH_PRODUCT_ID, -200000000)
      const result = await tester.testCalculateResultOfFundingPayment(
        SQUEETH_PRODUCT_ID,
        scaledBN(1000, 8),
        FUNDING_PERIOD,
      )

      expect(result[2]).to.be.lt(0)
    })
  })

  describe('calculateFundingRate', () => {
    const testL = 50
    const testDL = 0
    const decimals = 8

    async function checkFundingRate(productId: number, testValues: number[][]) {
      let previousResult = constants.MaxInt256
      for (let testValue of testValues) {
        const result = await tester.testCalculateFundingRate(
          productId,
          numToBn(testValue[0], decimals),
          numToBn(testL, decimals),
          numToBn(testValue[1], decimals),
          numToBn(testDL, decimals),
        )

        expect(previousResult).to.be.gt(result)
        previousResult = result
      }
    }

    beforeEach(async () => {
      await tester.initialize(wallet.address, 1000000, scaledBN(1, 5))
    })

    it('as the pool position becomes longer, the funding rate becomes smaller', async () => {
      await checkFundingRate(FUTURE_PRODUCT_ID, [
        [10, 10],
        [10, -5],
        [10, -10],
        [10, -15],
        [10, -25],
      ])
      await checkFundingRate(SQUEETH_PRODUCT_ID, [
        [-10, 25],
        [-10, 15],
        [-10, 10],
        [-10, 5],
        [-10, -10],
      ])
    })
  })

  describe('calculateMarginDivLiquidity', () => {
    const decimals = 8

    function marginDivLiquidity(m: number, dm: number, l: number, dl: number) {
      if (dl == 0) {
        return (m + dm / 2) / l
      } else {
        return ((m + dm / 2) * (Math.log(l + dl) - Math.log(l))) / dl
      }
    }

    it('return a correct value', async () => {
      const testValuesOfLiquidity = [
        [50, 0],
        [50, 1],
        [50, 2],
        [50, -1],
        [50, -2],
      ]
      const testValuesOfMargin = [
        [10, 10],
        [10, 0],
        [10, -5],
        [10, -10],
        [10, -15],
        [10, -25],
        [-10, -10],
        [-10, 0],
        [-10, 5],
        [-10, 10],
        [-10, 15],
        [-10, 25],
      ]

      for (let testValueOfLiquidity of testValuesOfLiquidity) {
        for (let testValueOfMargin of testValuesOfMargin) {
          const expected = marginDivLiquidity(
            testValueOfMargin[0],
            testValueOfMargin[1],
            testValueOfLiquidity[0],
            testValueOfLiquidity[1],
          )
          const result = await tester.testCalculateMarginDivLiquidity(
            numToBn(testValueOfMargin[0], decimals),
            numToBn(testValueOfMargin[1], decimals),
            numToBn(testValueOfLiquidity[0], decimals),
            numToBn(testValueOfLiquidity[1], decimals),
          )

          assertCloseToPercentage(result, numToBn(expected, decimals))
        }
      }
    })
  })
})
