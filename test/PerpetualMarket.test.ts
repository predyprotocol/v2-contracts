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
import { increaseTime, scaledBN } from './utils/helpers'
import { FUTURE_PRODUCT_ID, SAFETY_PERIOD, SQEETH_PRODUCT_ID, VARIANCE_UPDATE_INTERVAL } from './utils/constants'

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

  const MaxUint256 = ethers.constants.MaxUint256

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

    await weth.mint(wallet.address, MaxUint256)
    await usdc.mint(wallet.address, MaxUint256.div(2))
    await usdc.mint(other.address, MaxUint256.div(2))

    // approve
    await weth.approve(perpetualMarket.address, MaxUint256)
    await usdc.approve(perpetualMarket.address, MaxUint256)

    // spot price is $1,000
    await testContractHelper.updateSpot(scaledBN(1000, 8))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('initialize', () => {
    describe('failure cases', () => {
      it('reverts if amount is 0', async () => {
        await expect(perpetualMarket.initialize(0, 100)).to.be.reverted
      })

      it('reverts if funding rate is 0', async () => {
        await expect(perpetualMarket.initialize(100, 0)).to.be.reverted
      })
    })

    describe('success cases', () => {
      it('initialize pool', async () => {
        await perpetualMarket.initialize(100, 100)
      })
    })
  })

  describe('deposit', () => {
    const vaultId = 0

    describe('failure cases', () => {
      it('reverts if amount is 0', async () => {
        await expect(perpetualMarket.deposit(0)).to.be.reverted
      })
    })

    describe('success cases', () => {
      beforeEach(async () => {
        await perpetualMarket.initialize(scaledBN(30, 6), scaledBN(2, 5))
      })

      it('deposit', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.deposit(scaledBN(20, 6))
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(20000000)
      })

      it('withdrawal works after deposit', async () => {
        await perpetualMarket.deposit(scaledBN(20, 6))

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.withdraw(scaledBN(20, 6))
        const after = await usdc.balanceOf(wallet.address)

        expect(before.sub(after)).to.be.eq(-20000000)
      })
    })

    describe('unrealized PnL > 0 and realized PnL > 0', () => {
      beforeEach(async () => {
        await perpetualMarket.initialize(scaledBN(30, 6), scaledBN(2, 5))

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(90, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))
      })

      it('deposit', async () => {
        const before = await perpetualMarket.balanceOf(wallet.address)
        await perpetualMarket.deposit(scaledBN(20, 6))
        const after = await perpetualMarket.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.lt(scaledBN(20, 6))
      })

      it('withdrawal works after deposit', async () => {
        const before = await usdc.balanceOf(perpetualMarket.address)
        const beforeLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)

        await perpetualMarket.deposit(scaledBN(20, 6))
        await perpetualMarket.withdraw(scaledBN(20, 6))

        const afterLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)
        const after = await usdc.balanceOf(perpetualMarket.address)

        expect(beforeLPTokenBalance).to.be.eq(afterLPTokenBalance)
        expect(after.sub(before)).to.be.eq(0)
      })

      it('large amount of deposit', async () => {
        const largeAmountOfUSDC = scaledBN(1, 15)
        const before = await usdc.balanceOf(perpetualMarket.address)
        const beforeLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)

        await perpetualMarket.deposit(largeAmountOfUSDC)
        await perpetualMarket.withdraw(largeAmountOfUSDC)

        const afterLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)
        const after = await usdc.balanceOf(perpetualMarket.address)

        expect(beforeLPTokenBalance).to.be.eq(afterLPTokenBalance)
        expect(after.sub(before)).to.be.eq(0)
      })
    })

    describe('unrealized PnL < 0 and realized PnL < 0', () => {
      beforeEach(async () => {
        await perpetualMarket.initialize(scaledBN(30, 6), scaledBN(2, 5))

        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await testContractHelper.updateSpot(scaledBN(110, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(5, 7))

        await increaseTime(SAFETY_PERIOD)
      })

      it('deposit', async () => {
        const before = await perpetualMarket.balanceOf(wallet.address)
        await perpetualMarket.deposit(scaledBN(20, 6))
        const after = await perpetualMarket.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(scaledBN(20, 6))
      })

      it('withdrawal works after deposit', async () => {
        const before = await usdc.balanceOf(perpetualMarket.address)
        const beforeLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)

        await perpetualMarket.deposit(scaledBN(20, 6))
        await perpetualMarket.withdraw(scaledBN(20, 6))

        const afterLPTokenBalance = await perpetualMarket.balanceOf(wallet.address)
        const after = await usdc.balanceOf(perpetualMarket.address)

        expect(beforeLPTokenBalance).to.be.eq(afterLPTokenBalance)
        expect(after.sub(before)).to.be.eq(0)
      })
    })
  })

  describe('withdraw', () => {
    const poolId = 0

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(100, 8))
      await perpetualMarket.initialize(scaledBN(100, 6), scaledBN(2, 5))
    })

    it('reverts if amount is 0', async function () {
      expect(perpetualMarket.withdraw(0)).to.be.reverted
    })

    it('reverts if caller is not position owner', async function () {
      expect(perpetualMarket.connect(other).withdraw(100)).to.be.reverted
    })

    it('reverts if withdraw with closing but there are no liquidity', async function () {
      await perpetualMarket.openLongPosition({
        productId: poolId,
        vaultId: 0,
        subVaultIndex: 0,
        collateralRatio: scaledBN(1, 8),
        tradeAmount: scaledBN(100, 6),
        limitPrice: 0,
        deadline: 0,
      })

      expect(perpetualMarket.withdraw(scaledBN(100, 6))).to.be.reverted
    })

    it('withdraw all', async function () {
      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.withdraw(scaledBN(100, 6))
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.equal(scaledBN(100, 6))
    })

    describe('tokenPrice becomes high', () => {
      const vaultId = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(94, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(1, 8))
      })

      it('withdraw all', async function () {
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.gt(scaledBN(100, 6))
      })

      it('LP token price is not changed', async function () {
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = (await testContractHelper.getWithdrawalAmount(tokenAmount, 0)).div(2)

        const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

        await perpetualMarket.withdraw(withdrawnAmount)

        const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

        checkEqRoughly(beforeLPTokenPrice, afterLPTokenPrice)
      })
    })

    describe('tokenPrice becomes low', () => {
      const vaultId = 0

      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))

        await testContractHelper.openLong(wallet, vaultId, scaledBN(1, 8))

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(106, 8))

        await testContractHelper.openShort(wallet, vaultId, scaledBN(1, 8))
      })

      it('withdraw all', async function () {
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)

        await perpetualMarket.withdraw(withdrawnAmount)

        expect(withdrawnAmount).to.lt(scaledBN(100, 6))
      })

      it('LP token price is not changed', async function () {
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = (await testContractHelper.getWithdrawalAmount(tokenAmount, 0)).div(2)

        const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

        await perpetualMarket.withdraw(withdrawnAmount)

        const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

        checkEqRoughly(beforeLPTokenPrice, afterLPTokenPrice)
      })
    })
  })

  describe('openPositions', () => {
    const vaultId = 0
    const subVaultIndex = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    it('variance updated', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      const before = await perpetualMarket.getTradePrice(SQEETH_PRODUCT_ID, 1000)

      await testContractHelper.updateSpot(scaledBN(110, 8))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)

      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await testContractHelper.updateSpot(scaledBN(100, 8))

      await increaseTime(VARIANCE_UPDATE_INTERVAL)

      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      const after = await perpetualMarket.getTradePrice(SQEETH_PRODUCT_ID, 1000)

      expect(after[0]).to.be.gt(before[0])
    })

    it('reverts by deadline', async () => {
      const blockNumber = await ethers.provider.getBlockNumber()
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: blockNumber + 1,
      })

      await expect(
        perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: blockNumber,
        }),
      ).to.be.revertedWith('PM0')
    })

    describe('limit price', () => {
      it('reverts long by limit price', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, '11000000000'],
          deadline: 0,
        })

        await expect(
          perpetualMarket.openPositions({
            vaultId,
            subVaultIndex,
            tradeAmounts: [0, scaledBN(1, 6)],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, '9000000000'],
            deadline: 0,
          }),
        ).to.be.revertedWith('PM1')
      })

      it('reverts short by limit price', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, '9000000000'],
          deadline: 0,
        })

        await expect(
          perpetualMarket.openPositions({
            vaultId,
            subVaultIndex,
            tradeAmounts: [0, scaledBN(-1, 6)],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, '11000000000'],
            deadline: 0,
          }),
        ).to.be.revertedWith('PM1')
      })
    })

    describe('Sqeeth', () => {
      it('open position and emit an event', async () => {
        await expect(
          perpetualMarket.openPositions({
            vaultId,
            subVaultIndex,
            tradeAmounts: [scaledBN(1, 6), 0],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, 0],
            deadline: 0,
          }),
        )
          .to.emit(perpetualMarket, 'PositionUpdated')
          .withArgs(wallet.address, vaultId, SQEETH_PRODUCT_ID, scaledBN(1, 6), 100300009, 0)

        // Check fee pool received protocol fee
        expect(await usdc.balanceOf(testContractSet.feePool.address)).to.be.gt(0)
      })

      it('close position', async () => {
        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-20')
      })

      it('close position with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('2082')
      })

      it('close position with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-1921')
      })
    })

    describe('Future', () => {
      it('open', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('close', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-2000')
      })

      it('close with profit', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('97900')
      })

      it('close with loss', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await testContractHelper.updateSpot(scaledBN(90, 8))
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-101900')
      })
    })

    describe('Sqeeth and Future', () => {
      it('open Sqeeth and Future contracts', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const vaultStatus = await perpetualMarket.getVaultStatus(wallet.address, vaultId)

        expect(vaultStatus.minCollateral).to.be.gt(0)
        expect(vaultStatus.positionValue).to.be.gte(vaultStatus.minCollateral)
        expect(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq(scaledBN(1, 6))
        expect(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq(scaledBN(1, 6))
      })

      it('close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-2020')
      })

      it('close Sqeeth', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-77020')
      })

      it('close Future', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-3520')
      })

      it('close positions with price move', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('99982')
      })

      it('large position', async () => {
        // 100B USDC
        await perpetualMarket.deposit(scaledBN(100, 15))

        // 1M Sqeeth and 1M ETH future
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 14), scaledBN(1, 14)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 14), scaledBN(-1, 14)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })
    })

    describe('long sqeeth and short future', () => {
      it('open long sqeeths and short futures', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const vaultStatus = await perpetualMarket.getVaultStatus(wallet.address, vaultId)

        expect(vaultStatus.minCollateral).to.be.gt(0)
        expect(vaultStatus.positionValue).to.be.gte(vaultStatus.minCollateral)
        expect(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[SQEETH_PRODUCT_ID]).to.be.eq(scaledBN(1, 6))
        expect(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[FUTURE_PRODUCT_ID]).to.be.eq(scaledBN(-1, 6))
      })

      it('close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-2022')
      })

      it('price becomes high and close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(110, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('-100019')
      })

      it('price becomes low and close positions', async () => {
        const before = await usdc.balanceOf(wallet.address)

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-1, 6), scaledBN(1, 6)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.eq('96176')
      })
    })
  })

  describe('liquidate', () => {
    const vaultId = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    describe('single sub-vaults', () => {
      const subVaultIndex = 0

      beforeEach(async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('liquidate a vault', async () => {
        await testContractHelper.updateSpot(scaledBN(98, 8))

        await perpetualMarket.liquidateByPool(wallet.address, vaultId)

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('liquidate an insolvent vault', async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.liquidateByPool(wallet.address, vaultId)

        await expect(
          perpetualMarket.openPositions({
            vaultId,
            subVaultIndex,
            tradeAmounts: [0, 0],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, 0],
            deadline: 0,
          }),
        ).to.be.revertedWith('T2')

        const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
        expect(vault.rawVaultData.isInsolvent).to.be.true
      })

      it('reverts if the vault has enough collateral', async () => {
        await expect(perpetualMarket.liquidateByPool(wallet.address, vaultId)).revertedWith('T1')
      })
    })

    describe('multiple sub-vaults', () => {
      beforeEach(async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex: 0,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex: 1,
          tradeAmounts: [scaledBN(1, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
      })

      it('liquidate a vault', async () => {
        await testContractHelper.updateSpot(scaledBN(98, 8))

        await perpetualMarket.liquidateByPool(wallet.address, vaultId)

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex: 0,
          tradeAmounts: [0, 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('liquidate an insolvent vault', async () => {
        await testContractHelper.updateSpot(scaledBN(90, 8))

        await perpetualMarket.liquidateByPool(wallet.address, vaultId)

        await expect(
          perpetualMarket.openPositions({
            vaultId,
            subVaultIndex: 0,
            tradeAmounts: [0, 0],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, 0],
            deadline: 0,
          }),
        ).to.be.revertedWith('T2')

        const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
        expect(vault.rawVaultData.isInsolvent).to.be.true
      })

      it('reverts if the vault has enough collateral', async () => {
        await expect(perpetualMarket.liquidateByPool(wallet.address, vaultId)).revertedWith('T1')
      })
    })
  })

  describe('execHedge', () => {
    const vaultId = 0
    const subVaultIndex = 0

    beforeEach(async () => {
      const amount = scaledBN(200, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))

      await testContractHelper.updateSpot(scaledBN(100, 8))
    })

    it('net delta is decreased', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 7), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[0]).to.be.true
      expect(tokenAmounts[1]).to.be.gt(0)
      expect(tokenAmounts[2]).to.be.gt(0)

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.execHedge()
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)

      const afterTokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(afterTokenAmounts[0]).to.be.false
      expect(afterTokenAmounts[1]).to.be.eq(0)
      expect(afterTokenAmounts[2]).to.be.eq(0)
    })

    it('reverts if net delta is positive', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 6), scaledBN(-1, 7)],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await expect(perpetualMarket.execHedge()).to.be.revertedWith('PMC4')
    })

    describe('net delta is negative', () => {
      beforeEach(async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 7), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        await perpetualMarket.execHedge()

        await increaseTime(60 * 60 * 12)
      })

      it('net delta is increased', async () => {
        await perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(-2, 6), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        })

        const beforeTradePrice = await perpetualMarket.getTradePrice(SQEETH_PRODUCT_ID, 1000)

        const before = await weth.balanceOf(wallet.address)
        await perpetualMarket.execHedge()
        const after = await weth.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)

        expect((await perpetualMarket.getTradePrice(SQEETH_PRODUCT_ID, 1000))[0]).to.be.gt(beforeTradePrice[0])
      })
    })
  })

  describe('funding payment', () => {
    const vaultId = 0
    const subVaultIndex = 0

    beforeEach(async () => {
      const amount = scaledBN(5000, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))

      await testContractHelper.updateSpot(scaledBN(1000, 8))
    })

    it('pool receives funding fee from sqeeth positions', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 8), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await increaseTime(24 * 60 * 60)

      const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

      await expect(
        perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [scaledBN(1, 8), 0],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        }),
      ).to.emit(testContractSet.perpetualMarketCore, 'FundingPayment')

      const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)
      expect(afterLPTokenPrice).to.be.gt(beforeLPTokenPrice)

      // check vault status
      const vaultStatus = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
      expect(vaultStatus.fundingPaid[0][SQEETH_PRODUCT_ID]).to.be.lt(0)
      expect(vaultStatus.fundingPaid[0][FUTURE_PRODUCT_ID]).to.be.eq(0)
    })

    it('pool receives from positive funding fee of future positions', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [0, scaledBN(1, 8)],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await increaseTime(24 * 60 * 60)

      const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [0, scaledBN(1, 8)],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

      expect(afterLPTokenPrice).to.be.gt(beforeLPTokenPrice)
    })

    it('pool receives from negative funding fee of future positions', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [0, scaledBN(-1, 8)],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await increaseTime(24 * 60 * 60)

      const beforeLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

      await expect(
        perpetualMarket.openPositions({
          vaultId,
          subVaultIndex,
          tradeAmounts: [0, scaledBN(-1, 8)],
          collateralRatio: scaledBN(1, 8),
          limitPrices: [0, 0],
          deadline: 0,
        }),
      ).to.emit(testContractSet.perpetualMarketCore, 'FundingPayment')

      const afterLPTokenPrice = await perpetualMarket.getLPTokenPrice(0)

      expect(afterLPTokenPrice).to.be.gt(beforeLPTokenPrice)

      // check vault status
      const vaultStatus = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
      expect(vaultStatus.fundingPaid[0][SQEETH_PRODUCT_ID]).to.be.eq(0)
      expect(vaultStatus.fundingPaid[0][FUTURE_PRODUCT_ID]).to.be.lt(0)
    })
  })

  describe('getMinCollateral', () => {
    const vaultId = 0
    const subVaultIndex = 0

    beforeEach(async () => {
      const amount = scaledBN(5000, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))

      await testContractHelper.updateSpot(scaledBN(1000, 8))
    })

    it('get min collateral of 0 positions', async () => {
      expect(await perpetualMarket.getMinCollateral(wallet.address, vaultId, [0, 0], scaledBN(1000, 8))).to.be.eq(0)
    })

    it('get min collateral of the vault that has no positions', async () => {
      expect(
        await perpetualMarket.getMinCollateral(wallet.address, vaultId, [scaledBN(1, 8), 0], scaledBN(1000, 8)),
      ).to.be.eq(1500000000)
    })

    it('get min collateral with $2,000 spot price', async () => {
      expect(
        await perpetualMarket.getMinCollateral(wallet.address, vaultId, [scaledBN(1, 8), 0], scaledBN(2000, 8)),
      ).to.be.eq(6000000000)
    })

    it('get min collateral of squared perpetual and perpetual future', async () => {
      expect(
        await perpetualMarket.getMinCollateral(
          wallet.address,
          vaultId,
          [scaledBN(1, 8), scaledBN(-1, 8)],
          scaledBN(1000, 8),
        ),
      ).to.be.eq(6000000000)
    })

    it('get min collateral of squared perpetual and perpetual future with $2,000 spot price', async () => {
      expect(
        await perpetualMarket.getMinCollateral(
          wallet.address,
          vaultId,
          [scaledBN(1, 8), scaledBN(-1, 8)],
          scaledBN(2000, 8),
        ),
      ).to.be.eq(9000000000)
    })

    it('get min collateral of the vault that has positions', async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(1, 8), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      expect(
        await perpetualMarket.getMinCollateral(wallet.address, vaultId, [scaledBN(1, 8), 0], scaledBN(1000, 8)),
      ).to.be.eq(3000000000)
    })
  })

  describe('setLiquidationFee', () => {
    it('set liquidation fee', async () => {
      await perpetualMarket.setLiquidationFee(10)
    })

    it('reverts if caller is not owner', async () => {
      await expect(perpetualMarket.connect(other).setLiquidationFee(0)).to.be.reverted
    })

    it('reverts if value is negative', async () => {
      await expect(perpetualMarket.setLiquidationFee(-1)).to.be.reverted
    })

    it('reverts if value is greater than 5000', async () => {
      await expect(perpetualMarket.setLiquidationFee(5001)).to.be.reverted
    })
  })
})
