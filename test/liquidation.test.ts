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
import { MAX_WITHDRAW_AMOUNT, SAFETY_PERIOD, SQUEETH_PRODUCT_ID } from './utils/constants'

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

    // spot price is $2,000
    await updateSpotPrice(2000)

    const amount = scaledBN(50000, 6)
    await perpetualMarket.initialize(amount, scaledBN(2, 5))
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('single sub-vaults', () => {
    const subVaultIndex = 0

    beforeEach(async () => {
      await perpetualMarket.trade({
        vaultId: 0,
        trades: [
          {
            productId: SQUEETH_PRODUCT_ID,
            subVaultIndex,
            tradeAmount: scaledBN(10, 8),
            limitPrice: 0,
          },
        ],
        marginAmount: scaledBN(615, 6),
        deadline: 0,
      })

      const vault = await perpetualMarket.getVaultStatus(1)
      expect(vault.rawVaultData.positionUsdc).to.be.eq(61500000000)
    })

    it('reverts if the vault has enough margin', async () => {
      // Deposit USDC
      await perpetualMarket.trade({
        vaultId: 0,
        trades: [],
        marginAmount: scaledBN(100, 6),
        deadline: 0,
      })

      await expect(perpetualMarket.liquidateByPool(1)).revertedWith('vault is not danger')
    })

    it('liquidate an insolvent vault', async () => {
      await updateSpotPrice(1800)

      await perpetualMarket.liquidateByPool(1)

      const vault = await perpetualMarket.getVaultStatus(1)
      expect(vault.minCollateral).to.be.eq(0)
      expect(vault.rawVaultData.positionUsdc).to.be.lt(0)
      expect(vault.positionValue).to.be.lt(0)
      expect(vault.rawVaultData.isInsolvent).to.be.true

      await expect(
        perpetualMarket.trade({
          vaultId: 1,
          trades: [],
          marginAmount: scaledBN(1, 8),
          deadline: 0,
        }),
      ).to.be.revertedWith('T2')
    })

    describe('withdraw all USDC after the vault liquidated', () => {
      afterEach(async () => {
        // LP can withdraw USDC
        const tokenAmount = await testContractSet.perpetualMarketCore.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)
        await perpetualMarket.withdraw(withdrawnAmount)

        expect(await testContractSet.perpetualMarketCore.balanceOf(wallet.address)).to.be.lte(100)
      })

      it('liquidate a vault', async () => {
        await updateSpotPrice(1960)

        const protocolFeeBefore = await usdc.balanceOf(testContractSet.feePool.address)
        await perpetualMarket.liquidateByPool(1)
        const protocolFeeAfter = await usdc.balanceOf(testContractSet.feePool.address)

        // check protocol fee
        expect(protocolFeeAfter.sub(protocolFeeBefore)).to.be.gt(0)

        const vault = await perpetualMarket.getVaultStatus(1)
        expect(vault.minCollateral).to.be.eq(0)
        expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
        expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)
        expect(vault.rawVaultData.isInsolvent).to.be.false

        const before = await usdc.balanceOf(wallet.address)
        await perpetualMarket.trade({
          vaultId: 1,
          trades: [],
          marginAmount: MAX_WITHDRAW_AMOUNT,
          deadline: 0,
        })
        const after = await usdc.balanceOf(wallet.address)

        expect(after.sub(before)).to.be.gt(0)
      })

      it('liquidate a vault by funding payment', async () => {
        await increaseTime(60 * 60 * 24 * 2)

        await perpetualMarket.liquidateByPool(1)

        const vault = await perpetualMarket.getVaultStatus(1)
        expect(vault.minCollateral).to.be.eq(0)
        expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
        expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)
        expect(vault.rawVaultData.isInsolvent).to.be.false
      })

      describe('usdc position is negative', () => {
        beforeEach(async () => {
          await updateSpotPrice(2400)

          // Withdraw unrequired USDC
          await perpetualMarket.trade({
            vaultId: 1,
            trades: [],
            marginAmount: MAX_WITHDRAW_AMOUNT,
            deadline: 0,
          })

          const vault = await perpetualMarket.getVaultStatus(1)
          expect(vault.rawVaultData.positionUsdc).to.be.lt(0)
        })

        it('liquidate a vault', async () => {
          await updateSpotPrice(2360)

          await perpetualMarket.liquidateByPool(1)

          const vault = await perpetualMarket.getVaultStatus(1)
          expect(vault.minCollateral).to.be.eq(0)
          expect(vault.rawVaultData.positionUsdc).to.be.gt(0)
          expect(vault.rawVaultData.positionUsdc).to.be.eq(vault.positionValue)

          const before = await usdc.balanceOf(wallet.address)
          await perpetualMarket.trade({
            vaultId: 1,
            trades: [],
            marginAmount: MAX_WITHDRAW_AMOUNT,
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
      await perpetualMarket.trade({
        vaultId: 0,
        trades: [
          {
            productId: SQUEETH_PRODUCT_ID,
            subVaultIndex: 0,
            tradeAmount: scaledBN(10, 8),
            limitPrice: 0,
          },
        ],
        marginAmount: scaledBN(1220, 6),
        deadline: 0,
      })
      await perpetualMarket.trade({
        vaultId: 1,
        trades: [
          {
            productId: SQUEETH_PRODUCT_ID,
            subVaultIndex: 1,
            tradeAmount: scaledBN(10, 8),
            limitPrice: 0,
          },
        ],
        marginAmount: 0,
        deadline: 0,
      })
    })

    it('liquidate a vault', async () => {
      await updateSpotPrice(1960)

      await perpetualMarket.liquidateByPool(1)

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.trade({
        vaultId: 1,
        trades: [],
        marginAmount: MAX_WITHDRAW_AMOUNT,
        deadline: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)
    })

    it('liquidate a vault by funding payment', async () => {
      await increaseTime(60 * 60 * 24)

      await perpetualMarket.liquidateByPool(1)

      const before = await usdc.balanceOf(wallet.address)
      await perpetualMarket.trade({
        vaultId: 1,
        trades: [],
        marginAmount: MAX_WITHDRAW_AMOUNT,
        deadline: 0,
      })
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)
    })

    it('liquidate an insolvent vault', async () => {
      await updateSpotPrice(1800)

      await perpetualMarket.liquidateByPool(1)

      await expect(
        perpetualMarket.trade({
          vaultId: 1,
          trades: [],
          marginAmount: scaledBN(1, 8),
          deadline: 0,
        }),
      ).to.be.revertedWith('T2')

      const vault = await perpetualMarket.getVaultStatus(1)
      expect(vault.rawVaultData.isInsolvent).to.be.true
    })

    it('reverts if the vault has enough margin', async () => {
      // Deposit USDC
      await perpetualMarket.trade({
        vaultId: 1,
        trades: [],
        marginAmount: scaledBN(5, 7),
        deadline: 0,
      })

      await expect(perpetualMarket.liquidateByPool(1)).revertedWith('vault is not danger')
    })
  })
})
