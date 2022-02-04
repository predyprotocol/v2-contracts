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
import { increaseTime, scaledBN } from './utils/helpers'
import { SAFETY_PERIOD } from './utils/constants'

describe('liquidation', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxUint256 = ethers.constants.MaxUint256
  const vaultId = 0

  async function updateSpotPrice(spotPrice: number) {
    await increaseTime(SAFETY_PERIOD)
    await testContractHelper.updateSpot(scaledBN(spotPrice, 8))
  }

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
    await usdc.connect(other).approve(perpetualMarket.address, MaxUint256)

    // spot price is $100
    await updateSpotPrice(1000)

    const amount = scaledBN(20000, 6)
    await perpetualMarket.initialize(amount, scaledBN(2, 5))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('single sub-vaults', () => {
    const subVaultIndex = 0

    beforeEach(async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [scaledBN(10, 8), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })

      const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
      expect(vault.rawVaultData.positionUsdc).to.be.eq(15200000000)
    })

    it('reverts if the vault has enough collateral', async () => {
      // Deposit USDC
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex,
        tradeAmounts: [0, 0],
        collateralRatio: scaledBN(5, 7),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await expect(perpetualMarket.liquidateByPool(wallet.address, vaultId)).revertedWith('vault is not danger')
    })

    it('liquidate an insolvent vault', async () => {
      await updateSpotPrice(900)

      await perpetualMarket.liquidateByPool(wallet.address, vaultId)

      const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
      expect(vault.minCollateral).to.be.eq(0)
      expect(vault.rawVaultData.positionUsdc).to.be.lt(0)
      expect(vault.positionValue).to.be.lt(0)
      expect(vault.rawVaultData.isInsolvent).to.be.true

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
    })

    describe('withdraw all USDC after the vault liquidated', () => {
      afterEach(async () => {
        // LP can withdraw USDC
        const tokenAmount = await perpetualMarket.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)
        await perpetualMarket.withdraw(withdrawnAmount)

        expect(await perpetualMarket.balanceOf(wallet.address)).to.be.eq(0)
      })

      it('liquidate a vault', async () => {
        await updateSpotPrice(980)

        const protocolFeeBefore = await usdc.balanceOf(testContractSet.feePool.address)
        await perpetualMarket.liquidateByPool(wallet.address, vaultId)
        const protocolFeeAfter = await usdc.balanceOf(testContractSet.feePool.address)

        // check protocol fee
        expect(protocolFeeAfter.sub(protocolFeeBefore)).to.be.gt(0)

        const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
        expect(vault.minCollateral).to.be.eq(0)
        expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
        expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)
        expect(vault.rawVaultData.isInsolvent).to.be.false

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

      it('liquidate a vault by funding payment', async () => {
        await increaseTime(60 * 60 * 1)

        await perpetualMarket.liquidateByPool(wallet.address, vaultId)

        const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
        expect(vault.minCollateral).to.be.eq(0)
        expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
        expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)
        expect(vault.rawVaultData.isInsolvent).to.be.false
      })

      describe('usdc position is negative', () => {
        beforeEach(async () => {
          await updateSpotPrice(1200)

          // Withdraw unrequired USDC
          await perpetualMarket.openPositions({
            vaultId,
            subVaultIndex,
            tradeAmounts: [0, 0],
            collateralRatio: scaledBN(1, 8),
            limitPrices: [0, 0],
            deadline: 0,
          })

          const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
          expect(vault.rawVaultData.positionUsdc).to.be.lt(0)
        })

        it('liquidate a vault', async () => {
          await updateSpotPrice(1180)

          await perpetualMarket.liquidateByPool(wallet.address, vaultId)

          const vault = await perpetualMarket.getVaultStatus(wallet.address, vaultId)
          expect(vault.minCollateral).to.be.eq(0)
          expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
          expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)

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
      })
    })
  })

  describe('multiple sub-vaults', () => {
    beforeEach(async () => {
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex: 0,
        tradeAmounts: [scaledBN(10, 8), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex: 1,
        tradeAmounts: [scaledBN(10, 8), 0],
        collateralRatio: scaledBN(1, 8),
        limitPrices: [0, 0],
        deadline: 0,
      })
    })

    it('liquidate a vault', async () => {
      await updateSpotPrice(980)

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
      await updateSpotPrice(900)

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
      // Deposit USDC
      await perpetualMarket.openPositions({
        vaultId,
        subVaultIndex: 0,
        tradeAmounts: [0, 0],
        collateralRatio: scaledBN(5, 7),
        limitPrices: [0, 0],
        deadline: 0,
      })

      await expect(perpetualMarket.liquidateByPool(wallet.address, vaultId)).revertedWith('vault is not danger')
    })
  })
})
