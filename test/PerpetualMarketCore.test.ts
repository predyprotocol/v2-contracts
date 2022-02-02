import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockChainlinkAggregator, PerpetualMarketCore } from '../typechain'
import { BigNumberish, Wallet } from 'ethers'
import { restoreSnapshot, takeSnapshot } from './utils/deploy'
import { increaseTime, scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, SAFETY_PERIOD, SQEETH_PRODUCT_ID, VARIANCE_UPDATE_INTERVAL } from './utils/constants'

describe('PerpetualMarketCore', function () {
  let wallet: Wallet, other: Wallet

  let priceFeed: MockChainlinkAggregator
  let perpetualMarketCore: PerpetualMarketCore
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
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1999806)
    })

    it('deposits after pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(1998805)
    })

    it('deposits after pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(1000000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(1999960)
      expect(await perpetualMarketCore.supply()).to.be.eq(2000811)
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
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await expect(perpetualMarketCore.withdraw(1000000)).to.be.revertedWith('PMC0')
    })

    it('withdraws after the pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(500598)
    })

    it('withdraws after the pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)

      await increaseTime(SAFETY_PERIOD)
      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.withdraw(500000)

      expect(await perpetualMarketCore.amountLiquidity()).to.be.eq(499960)
      expect(await perpetualMarketCore.supply()).to.be.eq(499595)
    })
  })

  describe('updatePoolPosition', () => {
    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).updatePoolPosition(SQEETH_PRODUCT_ID, 1000)).to.be.revertedWith(
        'PMC2',
      )
    })

    it('reverts if pool has no liquidity', async () => {
      await expect(perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 1000)).to.be.revertedWith('PMC1')
    })

    describe('after initialized', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(scaledBN(10, 8), scaledBN(5, 5))
      })

      it('reverts if pool has no enough liquidity', async () => {
        await expect(perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(100, 8))).to.be.revertedWith(
          'PMC1',
        )
      })

      it('sqeeth position increased', async () => {
        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 100000)

        const pool = await perpetualMarketCore.pools(SQEETH_PRODUCT_ID)
        expect(pool.amountLockedLiquidity).to.be.gt(0)
      })

      it('sqeeth position decreased', async () => {
        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 100000)
        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, -100000)

        const pool = await perpetualMarketCore.pools(SQEETH_PRODUCT_ID)
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
        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, 2000000)

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
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))
      await perpetualMarketCore.updatePoolSnapshot()
      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.eq(afterTradePrice[0])
    })

    it('variance becomes low', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1020, 8))
      await perpetualMarketCore.updatePoolSnapshot()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.gt(afterTradePrice[0])
    })

    it('variance becomes high', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1050, 8))
      await perpetualMarketCore.updatePoolSnapshot()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(SQEETH_PRODUCT_ID, scaledBN(1, 6))

      expect(beforeTradePrice[0]).to.be.lt(afterTradePrice[0])
    })
  })

  describe('getTokenAmountForHedging', () => {
    beforeEach(async () => {
      await updateSpot(scaledBN(1000, 8))
    })

    it('get token amounts with min slippage tolerance', async () => {
      await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20080000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    it('slippage tolerance becomes big price move', async () => {
      await updateSpot(scaledBN(980, 8))

      await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

      await updateSpot(scaledBN(1000, 8))

      await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(1, 5))

      const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

      expect(tokenAmounts.amountUsdc).to.be.eq(20144000)
      expect(tokenAmounts.amountUnderlying).to.be.eq(20000)
    })

    describe('delta is negative', () => {
      beforeEach(async () => {
        await perpetualMarketCore.initialize(scaledBN(2000, 6), scaledBN(5, 5))

        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(1, 5))
      })

      it('get token amounts with min slippage tolerance', async () => {
        const beforeTokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()
        await perpetualMarketCore.completeHedgingProcedure({
          amountUsdc: beforeTokenAmounts[0],
          amountUnderlying: beforeTokenAmounts[1],
          isLong: true,
          deltas: beforeTokenAmounts.deltas,
        })

        await updateSpot(scaledBN(1000, 8))

        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(-1, 5))

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
          deltas: beforeTokenAmounts.deltas,
        })

        await updateSpot(scaledBN(1000, 8))

        await perpetualMarketCore.updatePoolPosition(SQEETH_PRODUCT_ID, scaledBN(-1, 5))

        const tokenAmounts = await perpetualMarketCore.getTokenAmountForHedging()

        expect(tokenAmounts.amountUsdc).to.be.eq(19458880)
        expect(tokenAmounts.amountUnderlying).to.be.eq(19600)
      })
    })
  })
})
