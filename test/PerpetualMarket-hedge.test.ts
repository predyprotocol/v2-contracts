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
import { MIN_MARGIN } from './utils/constants'

describe('hedge', function () {
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

    await testContractHelper.updateSpot(scaledBN(300067, 6))

    await perpetualMarket.initialize(scaledBN(50000000, 6), scaledBN(2, 5))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('rebalance required', () => {
    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(300067, 6))

      await testContractHelper.trade(wallet, 0, [scaledBN(-1, 8), scaledBN(1, 8)], MIN_MARGIN)

      await testContractHelper.trade(wallet, 1, [scaledBN(5, 7), scaledBN(1, 8)], MIN_MARGIN)
    })

    it('enough USDC locked for a hedge', async () => {
      await perpetualMarket.execHedge()
      const result = await perpetualMarket.getTokenAmountForHedging()

      expect(result[1]).to.be.eq(0)
      expect(result[2]).to.be.eq(0)
    })
  })
})
