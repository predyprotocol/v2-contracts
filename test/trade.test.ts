import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MockERC20, PerpetualMarket } from '../typechain'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import {
  deployTestContractSet,
  restoreSnapshot,
  takeSnapshot,
  TestContractHelper,
  TestContractSet,
} from './utils/deploy'
import { scaledBN } from './utils/helpers'

function checkEqRoughly(a: BigNumberish, b: BigNumberish) {
  expect(a).to.be.lte(BigNumber.from(b).add(1))
  expect(a).to.be.gte(BigNumber.from(b).sub(1))
}

describe('PerpetualMarket', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxInt128 = BigNumber.from(2).pow(127).sub(1)

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    // mint 2^127 - 1 ETH
    const testAmount = MaxInt128
    await weth.mint(wallet.address, testAmount)

    // mint 2^127 - 1 USDC
    const testUsdcAmount = MaxInt128
    await usdc.mint(wallet.address, testUsdcAmount)
    await usdc.mint(other.address, testUsdcAmount)

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
      await testContractHelper.updateSpot(scaledBN(1200, 8))
      await perpetualMarket.initialize(scaledBN(200000, 6), scaledBN(2, 5))
    })

    describe('tokenPrice becomes high', () => {
      const vaultId = 0
      const subVaultIndex = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(1000, 8))

        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(2, 8)],
          collateralRatio: scaledBN(5, 7),
          limitPrices: [0, 0],
          deadline: 0,
        })

        //        await increaseTime(SAFETY_PERIOD * 2)
        await testContractHelper.updateSpot(scaledBN(950, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-2, 8)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('withdraw all', async function () {
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(5000, 6))

        expect(await usdc.balanceOf(perpetualMarket.address)).to.eq(141)
        expect(await perpetualMarket.balanceOf(wallet.address)).to.eq(0)
      })
    })
  })
})
