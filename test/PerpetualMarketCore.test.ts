import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockChainlinkAggregator, PerpetualMarketCore } from '../typechain'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { restoreSnapshot, takeSnapshot } from './utils/deploy'
import { increaseTime, scaledBN } from './utils/helpers'
import { VARIANCE_UPDATE_INTERVAL } from './utils/constants'

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

      expect(await perpetualMarketCore.liquidityAmount()).to.be.eq(1000)
      expect(await perpetualMarketCore.supply()).to.be.eq(1000)
    })
  })

  describe('deposit', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(1000, scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).deposit(1000)).to.be.revertedWith('PMC2')
    })

    it('suceed to deposit', async () => {
      await perpetualMarketCore.deposit(1000)

      expect(await perpetualMarketCore.liquidityAmount()).to.be.eq(2000)
      expect(await perpetualMarketCore.supply()).to.be.eq(2000)
    })

    it('position increased', async () => {
      await perpetualMarketCore.updatePoolPosition(0, 1000)

      await perpetualMarketCore.deposit(1000)

      expect(await perpetualMarketCore.liquidityAmount()).to.be.eq(2000)
      expect(await perpetualMarketCore.supply()).to.be.eq(1999)
    })

    it('pool gets profit', async () => {
      await perpetualMarketCore.updatePoolPosition(0, 1000)

      await updateSpot(scaledBN(995, 8))

      await perpetualMarketCore.deposit(1000)

      expect(await perpetualMarketCore.liquidityAmount()).to.be.eq(2000)
      expect(await perpetualMarketCore.supply()).to.be.eq(1989)
    })

    it('pool gets loss', async () => {
      await perpetualMarketCore.updatePoolPosition(0, 1000)

      await updateSpot(scaledBN(1005, 8))

      await perpetualMarketCore.deposit(1000)

      expect(await perpetualMarketCore.liquidityAmount()).to.be.eq(2000)
      expect(await perpetualMarketCore.supply()).to.be.eq(2008)
    })
  })

  describe('updateVariance', () => {
    beforeEach(async () => {
      await perpetualMarketCore.initialize(scaledBN(10, 6), scaledBN(5, 5))
    })

    it('reverts if caller is not PerpetualMarket', async () => {
      await expect(perpetualMarketCore.connect(other).updateVariance()).to.be.revertedWith('PMC2')
    })

    it('variance is not updated', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))
      await perpetualMarketCore.updateVariance()
      const afterTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))

      expect(beforeTradePrice).to.be.eq(afterTradePrice)
    })

    it('variance becomes low', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1020, 8))
      await perpetualMarketCore.updateVariance()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))

      expect(beforeTradePrice).to.be.gt(afterTradePrice)
    })

    it('variance becomes high', async () => {
      const beforeTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)
      await updateSpot(scaledBN(1050, 8))
      await perpetualMarketCore.updateVariance()
      await updateSpot(scaledBN(1000, 8))

      const afterTradePrice = await perpetualMarketCore.getTradePrice(0, scaledBN(1, 6))

      expect(beforeTradePrice).to.be.lt(afterTradePrice)
    })
  })
})
