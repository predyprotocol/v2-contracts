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
import { increaseTime, scaledBN } from './utils/helpers'
import {
  BLOCKS_PER_DAY,
  MAX_WITHDRAW_AMOUNT,
  MIN_MARGIN,
  SAFETY_BLOCK_PERIOD,
  SQUEETH_PRODUCT_ID,
} from './utils/constants'
import { MockArbSys } from '../typechain/MockArbSys'

describe('liquidation', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20
  let arbSys: MockArbSys

  let testContractSet: TestContractSet
  let testContractHelper: TestContractHelper
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  const MaxUint256 = ethers.constants.MaxUint256

  async function updateSpotPrice(spotPrice: number) {
    await increaseBlockNumber(SAFETY_BLOCK_PERIOD)
    await testContractHelper.updateSpot(scaledBN(spotPrice, 8))
  }

  async function increaseBlockNumber(blocknumber: number) {
    const currentBlockNumber = await ethers.provider.getBlockNumber()
    await arbSys.setBlockNumber(currentBlockNumber + blocknumber)
  }

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)
    testContractHelper = new TestContractHelper(testContractSet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket
    arbSys = testContractSet.arbSys
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
    beforeEach(async () => {
      await testContractHelper.trade(wallet, 0, [0, scaledBN(20, 8)], scaledBN(870, 6))

      const vault = await perpetualMarket.getVaultStatus(1)
      expect(vault.rawVaultData.positionUsdc).to.be.eq(87000000000)
    })

    it('reverts if the vault has enough margin', async () => {
      // Deposit USDC
      await perpetualMarket.trade({
        vaultId: 1,
        trades: [],
        marginAmount: scaledBN(100, 6),
        deadline: 0,
      })

      await expect(perpetualMarket.liquidateByPool(1)).revertedWith('vault is not danger')
    })

    it('reverts if the vault holds no positions', async () => {
      // Close position
      await testContractHelper.trade(wallet, 1, [0, scaledBN(-20, 8)], MAX_WITHDRAW_AMOUNT)

      await expect(perpetualMarket.liquidateByPool(1)).revertedWith('vault is not danger')
    })

    it('liquidate an insolvent vault', async () => {
      await updateSpotPrice(1800)

      await perpetualMarket.liquidateByPool(1)

      const vault = await perpetualMarket.getVaultStatus(1)
      expect(vault.minCollateral).to.be.eq(0)
      expect(vault.rawVaultData.positionUsdc).to.be.lt(0)
      expect(vault.positionValue).to.be.lt(0)

      // can not create position when the position value is less than 0
      await expect(
        perpetualMarket.trade({
          vaultId: 1,
          trades: [],
          marginAmount: scaledBN(1, 8),
          deadline: 0,
        }),
      ).to.be.revertedWith('T0')

      // deposit to already exist vault, it works when aother position value is less than 0
      const beforeBalance = await usdc.balanceOf(perpetualMarket.address)
      const beforeVault = await perpetualMarket.getTraderVault(1)
      await perpetualMarket.addMargin(1, scaledBN(100, 6))
      const afterBalance = await usdc.balanceOf(perpetualMarket.address)
      const afterVault = await perpetualMarket.getTraderVault(1)

      // check that USDC amount is increased
      expect(afterBalance.sub(beforeBalance)).to.be.eq(scaledBN(100, 6))
      expect(afterVault.positionUsdc.sub(beforeVault.positionUsdc)).to.be.eq(scaledBN(100, 8))
    })

    describe('withdraw all USDC after the vault liquidated', () => {
      afterEach(async () => {
        // LP can withdraw USDC
        const tokenAmount = await testContractSet.perpetualMarketCore.balanceOf(wallet.address)
        const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)
        await perpetualMarket.withdraw(withdrawnAmount)

        // rough check
        expect(await usdc.balanceOf(testContractSet.perpetualMarketCore.address)).to.be.lte(10)
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

    describe('after liquidated', () => {
      beforeEach(async () => {
        await updateSpotPrice(1960)

        await perpetualMarket.liquidateByPool(1)
      })

      it('reverts if the vault has been liquidated', async () => {
        await expect(perpetualMarket.liquidateByPool(1)).revertedWith('vault is not danger')
      })

      it('trade after liquidated', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(10, 8)], MIN_MARGIN)

        const vaultStatus = await perpetualMarket.getVaultStatus(1)
        expect(vaultStatus.minCollateral).to.be.gt(0)
        expect(vaultStatus.positionValue).to.be.gt(vaultStatus.minCollateral)
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
            metadata: '0x',
          },
        ],
        marginAmount: scaledBN(870, 6),
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
            metadata: '0x',
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

      // can not create position when the position value is less than 0
      await expect(
        perpetualMarket.trade({
          vaultId: 1,
          trades: [],
          marginAmount: scaledBN(1, 8),
          deadline: 0,
        }),
      ).to.be.revertedWith('T0')

      // deposit to already exist vault, it works when aother position value is less than 0
      const beforeBalance = await usdc.balanceOf(perpetualMarket.address)
      const beforeVault = await perpetualMarket.getTraderVault(1)
      await perpetualMarket.addMargin(1, scaledBN(100, 6))
      const afterBalance = await usdc.balanceOf(perpetualMarket.address)
      const afterVault = await perpetualMarket.getTraderVault(1)

      // check that USDC amount is increased
      expect(afterBalance.sub(beforeBalance)).to.be.eq(scaledBN(100, 6))
      expect(afterVault.positionUsdc.sub(beforeVault.positionUsdc)).to.be.eq(scaledBN(100, 8))
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

  describe('crab position', () => {
    it('liquidate a crab position', async () => {
      await updateSpotPrice(2000)

      await testContractHelper.trade(wallet, 0, [scaledBN(28, 8), scaledBN(-70, 8)], scaledBN(1000, 6), 0)
      await testContractHelper.trade(wallet, 1, [scaledBN(28, 8), scaledBN(-70, 8)], 0, 1)
      await testContractHelper.trade(wallet, 1, [scaledBN(28, 8), scaledBN(-70, 8)], 0, 2)

      // check utilization ratio is greater than 75%
      const utilizationRatio = await testContractSet.perpetualMarketCore.getUtilizationRatio()
      expect(utilizationRatio).to.be.gt('75000000')

      await increaseBlockNumber(BLOCKS_PER_DAY / 24)

      await updateSpotPrice(1900)

      const beforeVaultStatus = await perpetualMarket.getVaultStatus(1)
      expect(beforeVaultStatus.positionValue).to.be.gt(0)

      await perpetualMarket.liquidateByPool(1)

      const afterVaultStatus = await perpetualMarket.getVaultStatus(1)
      expect(afterVaultStatus.positionValue).to.be.gt(0)
    })
  })
})
