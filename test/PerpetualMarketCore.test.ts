import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockChainlinkAggregator, PerpetualMarketCore, PerpetualMarketCoreTester } from '../typechain'
import { BigNumberish, Wallet } from 'ethers'
import { restoreSnapshot, takeSnapshot } from './utils/deploy'
import { increaseTime, scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, SAFETY_PERIOD, SQUEETH_PRODUCT_ID, VARIANCE_UPDATE_INTERVAL } from './utils/constants'

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
    perpetualMarketCore = (await PerpetualMarketCore.deploy(priceFeed.address)) as PerpetualMarketCore

    await perpetualMarketCore.setPerpetualMarket(wallet.address)

    const PerpetualMarketCoreTester = await ethers.getContractFactory('PerpetualMarketCoreTester')
    tester = (await PerpetualMarketCoreTester.deploy(priceFeed.address)) as PerpetualMarketCoreTester
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
      await expect(perpetualMarketCore.connect(other).initialize(1000, scaledBN(5, 5))).to.be.revertedWith('PMC2')
    })

    it('suceed to initialize', async () => {
      await perpetualMarketCore.initialize(1000, scaledBN(5, 5))

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1000)
      expect(await perpetualMarketCore.supply()).to.be.eq(1000)
    })
  })

  describe('deposit', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(1000000, scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).deposit(1000)).to.be.revertedWith('PMC2')
    })

    it('suceed to deposit', async () => {
      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(2000000)
      expect(await perpetualMarketCore.supply()).to.be.eq(2000000)
    })

    it('deposits after that pool position increased', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1999736)
    })

    it('deposits after pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1998735)
    })

    it('deposits after pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(2000741)
    })
  })

  describe('withdraw', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(1000000, scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).withdraw(1000)).to.be.revertedWith('PMC2')
    })

    it('withdraws a half of liquidity', async () => {
      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(500000)
      expect(await perpetualMarketCore.supply()).to.be.eq(500000)
    })

    it('withdraws all', async () => {
      await perpetualMarketCore.withdraw(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(0)
      expect(await perpetualMarketCore.supply()).to.be.eq(0)
    })

    it('reverts withdrawal if there is little available liquidity', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await expect(perpetualMarketCore.withdraw(1000000)).to.be.revertedWith('PMC0')
    })

    it('withdraws after the pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(500633)
    })

    it('withdraws after the pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(499630)
    })

    it('spread becomes high', async () => {
      await perpetualMarketCore.deposit(1000000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1500000)
    })

    it('spread returns low after time passed', async () => {
      await perpetualMarketCore.deposit(1000000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await increaseTime(SAFETY_PERIOD)

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1500304)
    })

    it('spread becomes high when withdraw', async () => {
      await perpetualMarketCore.withdraw(500000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1500000)
    })

    it('spread returns low when withdraw', async () => {
      await perpetualMarketCore.withdraw(500000)

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(1005, 8))

      await increaseTime(SAFETY_PERIOD)

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1501273)
    })
  })

  describe('updatePoolPosition', () => {
    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)).to.be.revertedWith(
        'PMC2',
      )
    })

    it('reverts if pool has no liquidity', async () => {
      await expect(perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 1000)).to.be.revertedWith('PMC1')
    })

    describe('after initialized', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(scaledBN(10, 8), scaledBN(5, 5))
      })

      it('reverts if pool has no enough liquidity', async () => {
        await expect(perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(100, 8))).to.be.revertedWith(
          'PMC1',
        )
      })

      it('squeeth position increased', async () => {
        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)

        const pool = await perpetualMarketCore.pools(SQUEETH_PRODUCT_ID)
        expect(pool.amountLockedLiquidity).to.be.gt(0)
      })

      it('squeeth position decreased', async () => {
        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 100000)
        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, -100000)

        const pool = await perpetualMarketCore.pools(SQUEETH_PRODUCT_ID)
        expect(pool.amountLockedLiquidity).to.be.eq(0)
      })

      it('long position of futures increased', async () => {
        await perpetualMarketCore.updatePoolPosition(FUTURE_PRODUCT_ID, -100000)

        const pool = await perpetualMarketCore.pools(FUTURE_PRODUCT_ID)
        expect(pool.amountLockedLiquidity).to.be.gt(0)
      })

      it('long position of futures increased', async () => {
        await perpetualMarketCore.updatePoolPosition(FUTURE_PRODUCT_ID, -100000)
        await perpetualMarketCore.updatePoolPosition(FUTURE_PRODUCT_ID, 100000)

        const pool = await perpetualMarketCore.pools(FUTURE_PRODUCT_ID)
        expect(pool.amountLockedLiquidity).to.be.eq(0)
      })
    })

    describe('check utilization', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(scaledBN(10, 8), scaledBN(5, 5))
      })

      it('utilization ratio becomes high', async () => {
        await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, 2000000)

        const utilizationRatio = await perpetualMarketCore.getUtilizationRatio()
        expect(utilizationRatio).to.be.eq(78406272)
      })
    })
  })

  describe('updatePoolSnapshot', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(scaledBN(10, 8), scaledBN(5, 5))
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
      await updateSpot(scaledBN(1050, 8))
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
      await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20080000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    it('slippage tolerance becomes big price move', async () => {
      await updateSpot(scaledBN(980, 8))

      await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

      await updateSpot(scaledBN(1000, 8))

      await perpetualMarketCore.updatePoolPosition(SQUEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20144000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    describe('delta is negative', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

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
})
