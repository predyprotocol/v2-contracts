import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../../typechain'
import { BigNumber, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from '../utils/deploy'
import { scaledBN } from '../utils/helpers'
import { SAFETY_BLOCK_PERIOD } from '../utils/constants'
import { expect } from 'chai'
import { MockArbSys } from '../../typechain/MockArbSys'

describe('attack', function () {
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
    const currentBlockNumber = await ethers.provider.getBlockNumber()
    await arbSys.setBlockNumber(currentBlockNumber + blocknumber)
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

    // set SquaredPerpFundingMultiplier as 690%
    await testContractSet.perpetualMarketCore.setSquaredPerpFundingMultiplier(690000000)
    // set PerpFutureMaxFundingRate as 0.69%
    await testContractSet.perpetualMarketCore.setPerpFutureMaxFundingRate(690000)
    // trade fee is 0.05% and protocol fee is 0.01%
    await testContractSet.perpetualMarketCore.setTradeFeeRate(50000, 10000)
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('price manipulation attack', () => {
    const depositAmount = scaledBN(5000, 6)
    const initialSpotPrice = 1001

    async function execAttackScenario(baseSquaredPosition: BigNumber) {
      // Delta
      // ETH: 1 * 3.7
      // ETH2: 0.2 * 20.2 = 4.02
      const totalSquaredPosition = scaledBN(202, 7)

      await testContractHelper.trade(wallet, 0, [0, baseSquaredPosition], scaledBN(2000, 6))

      const beforeVaultStatus = await perpetualMarket.getVaultStatus(1)

      await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

      for (let i = 0; i < 10; i++) {
        // Short ETH
        await testContractHelper.trade(wallet, 1, [scaledBN(-37, 7), 0], 0)
        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)
        // Long ETH2
        await testContractHelper.trade(wallet, 1, [0, totalSquaredPosition.sub(baseSquaredPosition)], 0)
        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

        // Long ETH
        await testContractHelper.trade(wallet, 1, [scaledBN(37, 7), 0], 0)

        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

        // Short ETH2
        await testContractHelper.trade(wallet, 1, [0, baseSquaredPosition.sub(totalSquaredPosition)], 0)
        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)
      }

      const afterVaultStatus = await perpetualMarket.getVaultStatus(1)

      // Ensure that position value becomes smaller than before trade
      expect(afterVaultStatus.positionValue).to.be.lt(beforeVaultStatus.positionValue)
    }

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

      await perpetualMarket.initialize(depositAmount, 200000)
    })

    it('attack failed with 5 squared', async () => {
      await execAttackScenario(scaledBN(50, 7))
    })

    it('attack failed with 10 squared', async () => {
      await execAttackScenario(scaledBN(100, 7))
    })

    it('attack failed with 15.2 squared', async () => {
      await execAttackScenario(scaledBN(152, 7))
    })

    it('attack failed with 15.8 squared', async () => {
      await execAttackScenario(scaledBN(158, 7))
    })
  })

  describe('price manipulation attack', () => {
    const depositAmount = scaledBN(5000, 6)
    const initialSpotPrice = 1001

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

      await perpetualMarket.initialize(depositAmount, 100000)
    })

    it('attack failed', async () => {
      await testContractHelper.trade(wallet, 0, [0, 0], scaledBN(5000, 6))

      await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

      const beforeVaultStatus = await perpetualMarket.getVaultStatus(1)

      for (let i = 0; i < 10; i++) {
        await testContractHelper.trade(wallet, 1, [scaledBN(-15, 7), 0], 0)
        // Long ETH2

        const longTradePrices = await testContractHelper.tradeWithPrice(wallet, 1, [0, scaledBN(120, 7)], 0)
        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(15, 7), 0], 0)
        // Short ETH2

        await testContractHelper.trade(wallet, 1, [0, -100], 0)

        const shortTradePrice = await testContractHelper.tradeWithPrice(wallet, 1, [0, scaledBN(-120, 7).add(100)], 0)

        await increaseBlockNumber(SAFETY_BLOCK_PERIOD)

        expect(longTradePrices[0].gt(shortTradePrice[0])).to.be.true
      }

      console.log('total', (await testContractSet.perpetualMarketCore.amountLiquidity()).toString())
      console.log('locked', (await testContractSet.perpetualMarketCore.pools(1)).amountLockedLiquidity.toString())

      const afterVaultStatus = await perpetualMarket.getVaultStatus(1)

      // Ensure that position value becomes smaller than before trade
      expect(afterVaultStatus.positionValue).to.be.lt(beforeVaultStatus.positionValue)
    })
  })
})
