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
import { BLOCKS_PER_DAY, MAX_WITHDRAW_AMOUNT, MIN_MARGIN } from './utils/constants'
import { MockArbSys } from '../typechain/MockArbSys'

describe('hedge', function () {
  this.timeout(80000)

  let wallet: Wallet
  let weth: MockERC20
  let usdc: MockERC20
  let arbSys: MockArbSys
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
    arbSys = testContractSet.arbSys

    await weth.mint(wallet.address, MaxInt128)
    await usdc.mint(wallet.address, MaxInt128)

    // approve
    await weth.approve(perpetualMarket.address, MaxInt128)
    await usdc.approve(perpetualMarket.address, MaxInt128)
  })

  async function increaseBlockNumber(blocknumber: number) {
    const currentBlockNumber = await arbSys.arbBlockNumber()
    await arbSys.setBlockNumber(currentBlockNumber.add(blocknumber))
  }

  async function execHedge(withRebalance: boolean) {
    const amounts = await perpetualMarket.getTokenAmountForHedging()
    await perpetualMarket.execHedge(withRebalance, amounts[1])
  }

  beforeEach(async () => {
    snapshotId = await takeSnapshot()
    await increaseBlockNumber(0)
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('rebalance required', () => {
    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(300067, 6))

      await perpetualMarket.initialize(scaledBN(50000000, 6), scaledBN(2, 5))

      await testContractHelper.trade(wallet, 0, [scaledBN(-1, 8), scaledBN(1, 8)], MIN_MARGIN)

      await testContractHelper.trade(wallet, 1, [scaledBN(5, 7), scaledBN(1, 8)], MIN_MARGIN)
    })

    it('enough USDC locked for a hedge', async () => {
      await execHedge(true)
      const result = await perpetualMarket.getTokenAmountForHedging()

      expect(result[1]).to.be.eq(0)
      expect(result[2]).to.be.eq(0)
    })
  })

  describe('execHedge', () => {
    async function checkDeltaIs0() {
      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[0]).to.be.false
      expect(tokenAmounts[1]).to.be.eq(0)
      expect(tokenAmounts[2]).to.be.eq(0)
    }

    async function checkPoolPnL(balance: BigNumberish, upper?: BigNumberish) {
      const pool0 = await testContractSet.perpetualMarketCore.pools(0)
      const pool1 = await testContractSet.perpetualMarketCore.pools(1)

      if (!pool0.positionPerpetuals.eq(0) || !pool1.positionPerpetuals.eq(0)) {
        await testContractHelper.trade(
          wallet,
          1,
          [pool0.positionPerpetuals, pool1.positionPerpetuals],
          MAX_WITHDRAW_AMOUNT,
        )

        const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
        if (tokenAmounts[1].gt(0)) {
          await execHedge(true)
        }
      }

      await testContractHelper.trade(wallet, 1, [0, scaledBN(-1, 7)], MIN_MARGIN)
      await testContractHelper.trade(wallet, 1, [0, scaledBN(1, 7)], MAX_WITHDRAW_AMOUNT)

      {
        const vault2 = await perpetualMarket.getVaultStatus(2)
        if (vault2.positionValue.gt(0)) {
          await testContractHelper.trade(
            wallet,
            2,
            [
              vault2.rawVaultData.subVaults[0].positionPerpetuals[0].mul(-1),
              vault2.rawVaultData.subVaults[0].positionPerpetuals[1].mul(-1),
            ],
            MAX_WITHDRAW_AMOUNT,
          )
        }
      }

      const tokenAmount = await testContractSet.perpetualMarketCore.balanceOf(wallet.address)
      const withdrawnAmount = await testContractHelper.getWithdrawalAmount(tokenAmount, 0)
      await perpetualMarket.withdraw(withdrawnAmount)

      expect(withdrawnAmount).to.be.gt(balance)
      if (upper) {
        expect(withdrawnAmount).to.be.lt(upper)
      }

      expect(await testContractSet.perpetualMarketCore.balanceOf(wallet.address)).to.be.lte(100)
    }

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(100, 8))

      const amount = scaledBN(200, 6)

      await perpetualMarket.initialize(amount, scaledBN(2, 5))
    })

    it('net delta is decreased', async () => {
      await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 7)], MIN_MARGIN)

      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      expect(tokenAmounts[0]).to.be.true
      expect(tokenAmounts[1]).to.be.gt(0)
      expect(tokenAmounts[2]).to.be.gt(0)

      const before = await usdc.balanceOf(wallet.address)
      await execHedge(true)
      const after = await usdc.balanceOf(wallet.address)

      expect(after.sub(before)).to.be.gt(0)

      await checkDeltaIs0()
    })

    it('reverts if there are no WETH to sell(net delta is positive)', async () => {
      await testContractHelper.trade(wallet, 0, [scaledBN(-1, 7), scaledBN(1, 6)], MIN_MARGIN)

      await expect(execHedge(true)).to.be.revertedWith('N1')
    })

    it('reverts if usdc amounts are invalid', async () => {
      await testContractHelper.trade(wallet, 0, [scaledBN(1, 8), 0], MIN_MARGIN)

      const amounts0 = await perpetualMarket.getTokenAmountForHedging()
      await expect(perpetualMarket.execHedge(false, amounts0[1].add(1))).to.be.revertedWith('PM8')

      perpetualMarket.execHedge(false, amounts0[1])

      await testContractHelper.trade(wallet, 0, [scaledBN(-5, 7), 0], MIN_MARGIN)

      const amounts1 = await perpetualMarket.getTokenAmountForHedging()
      await expect(perpetualMarket.execHedge(false, amounts1[1].sub(1))).to.be.revertedWith('PM9')
    })

    describe('succeed to hedge in test cases', () => {
      async function checkHedge(
        beforePositions: BigNumberish[],
        price: number,
        isWethReceived: boolean,
        isHedgeHappened: boolean,
      ) {
        await testContractHelper.updateSpot(scaledBN(200, 8))

        await testContractHelper.trade(wallet, 1, beforePositions, MIN_MARGIN)

        await execHedge(true)

        await increaseTime(60 * 60 * 12)
        await increaseBlockNumber(BLOCKS_PER_DAY)

        await testContractHelper.updateSpot(scaledBN(price, 8))

        if (isHedgeHappened) {
          const before = await weth.balanceOf(wallet.address)
          await execHedge(true)
          const after = await weth.balanceOf(wallet.address)

          if (isWethReceived) {
            expect(after.sub(before)).to.be.gt(0)
          } else {
            expect(after.sub(before)).to.be.lt(0)
          }
        }

        // close
        await testContractHelper.trade(
          wallet,
          1,
          [BigNumber.from(beforePositions[0]).mul(-1), BigNumber.from(beforePositions[1]).mul(-1)],
          0,
        )
        await execHedge(true)
      }

      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 7)], MIN_MARGIN)
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-1, 7)], 0)
      })

      afterEach(async () => {
        await checkDeltaIs0()

        await checkPoolPnL(scaledBN(200, 6))
      })

      it('succeed to hedge', async () => {
        const testCases = [
          [0, scaledBN(1, 8)],
          [scaledBN(1, 6), scaledBN(1, 8)],
          [scaledBN(1, 6), scaledBN(2, 8)],
          [scaledBN(2, 6), scaledBN(1, 8)],
        ]

        for (let testData of testCases) {
          await checkHedge(testData, 250, false, true)
          await checkHedge(testData, 240, false, true)
          await checkHedge(testData, 220, false, true)
          await checkHedge(testData, 180, true, true)
          await checkHedge(testData, 160, true, true)
          await checkHedge(testData, 150, true, true)
        }
      })

      it('succeed to hedge(0 squared)', async () => {
        const testCases = [[scaledBN(1, 6), 0]]

        for (let testData of testCases) {
          await checkHedge(testData, 250, false, false)
          await checkHedge(testData, 240, false, false)
          await checkHedge(testData, 220, false, false)
          await checkHedge(testData, 210, false, false)
          await checkHedge(testData, 190, true, false)
          await checkHedge(testData, 180, true, false)
          await checkHedge(testData, 160, true, false)
          await checkHedge(testData, 150, true, false)
        }
      })

      it('succeed to hedge(short future)', async () => {
        const testCases = [[scaledBN(-1, 6), scaledBN(2, 8)]]

        for (let testData of testCases) {
          await checkHedge(testData, 250, false, true)
          await checkHedge(testData, 240, false, true)
          await checkHedge(testData, 220, false, true)
          await checkHedge(testData, 210, false, true)
          await checkHedge(testData, 190, true, true)
          await checkHedge(testData, 180, true, true)
          await checkHedge(testData, 160, true, true)
          await checkHedge(testData, 150, true, true)
        }
      })

      it('succeed to hedge(short future & delta is positive)', async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(1, 6), 0], MIN_MARGIN)
        await execHedge(true)

        const testCases = [[scaledBN(-5, 6), scaledBN(1, 8)]]

        for (let testData of testCases) {
          await checkHedge(testData, 250, false, false)
          await checkHedge(testData, 240, false, false)
          await checkHedge(testData, 220, false, false)
          await checkHedge(testData, 210, false, false)
          await checkHedge(testData, 190, true, false)
          await checkHedge(testData, 180, true, false)
          await checkHedge(testData, 160, true, false)
          await checkHedge(testData, 150, true, false)
        }

        await testContractHelper.trade(wallet, 2, [scaledBN(-1, 6), 0], MAX_WITHDRAW_AMOUNT)
        await execHedge(true)
      })

      it('succeed to hedge(short squared)', async () => {
        const testCases = [[scaledBN(2, 6), scaledBN(-1, 7)]]

        for (let testData of testCases) {
          await checkHedge(testData, 250, true, true)
          await checkHedge(testData, 240, true, true)
          await checkHedge(testData, 220, true, true)
          await checkHedge(testData, 210, true, true)
          await checkHedge(testData, 190, false, true)
          await checkHedge(testData, 180, false, true)
          await checkHedge(testData, 160, false, true)
          await checkHedge(testData, 150, false, true)
        }
      })

      it('succeed to hedge(short squared & delta is positive)', async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(1, 6), 0], MIN_MARGIN)
        await execHedge(true)

        const testCases = [[scaledBN(2, 6), scaledBN(-1, 8)]]

        for (let testData of testCases) {
          await checkHedge(testData, 250, true, false)
          await checkHedge(testData, 240, true, false)
          await checkHedge(testData, 220, true, false)
          await checkHedge(testData, 210, true, false)
          await checkHedge(testData, 190, false, false)
          await checkHedge(testData, 180, false, false)
          await checkHedge(testData, 160, false, false)
          await checkHedge(testData, 150, false, false)
        }

        await testContractHelper.trade(wallet, 2, [scaledBN(-1, 6), 0], MAX_WITHDRAW_AMOUNT)
        await execHedge(true)
      })

      it('succeed to hedge(crossing)', async () => {
        await testContractHelper.trade(wallet, 0, [0, scaledBN(-1, 7)], MIN_MARGIN)

        const testCases = [
          [0, scaledBN(1, 8)],
          [scaledBN(1, 6), scaledBN(1, 8)],
          [scaledBN(1, 6), scaledBN(2, 8)],
          [scaledBN(2, 6), scaledBN(1, 8)],
        ]

        for (let testData of testCases) {
          await checkHedge(testData, 250, false, true)
          await checkHedge(testData, 240, false, true)
          await checkHedge(testData, 220, false, true)
          await checkHedge(testData, 210, false, true)
          await checkHedge(testData, 190, true, true)
          await checkHedge(testData, 180, true, true)
          await checkHedge(testData, 160, true, true)
          await checkHedge(testData, 150, true, true)
        }

        await testContractHelper.trade(wallet, 2, [0, scaledBN(1, 7)], 0)
      })
    })

    describe('net delta is negative', () => {
      async function hedge(isBuyingETH: boolean) {
        const before = await weth.balanceOf(wallet.address)
        await execHedge(true)
        const after = await weth.balanceOf(wallet.address)

        if (isBuyingETH) {
          expect(after.sub(before)).to.be.lt(0)
        } else {
          expect(after.sub(before)).to.be.gt(0)
        }
      }

      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [0, scaledBN(1, 8)], MIN_MARGIN)

        await execHedge(true)

        await increaseTime(60 * 60 * 12)
        await increaseBlockNumber(BLOCKS_PER_DAY)
      })

      afterEach(async () => {
        await checkDeltaIs0()

        // spot price is 5% increased
        await testContractHelper.updateSpot(scaledBN(105, 8))

        // but pool value is 0.6% down at least
        await checkPoolPnL(scaledBN(200, 6).mul(9994).div(10000), scaledBN(200, 6).mul(10007).div(10000))
      })

      it('net delta increased to positive by future', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-2, 6), 0], 0)

        await hedge(false)
      })

      it('net delta increased to positive by squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-12, 7)], 0)

        await hedge(false)
      })

      it('net delta increased by squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-2, 7)], 0)

        await hedge(false)
      })

      it('net delta increased by future', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-1, 5), 0], 0)

        await hedge(false)
      })

      it('net delta increased', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-1, 5), scaledBN(-2, 7)], 0)

        await hedge(false)
      })

      it('net delta becomes 0', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-1, 8)], 0)

        await hedge(false)
      })

      it('net delta decreased by squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(2, 7)], 0)

        await hedge(true)
      })

      it('net delta decreased by future', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(1, 5), 0], 0)

        await hedge(true)
      })

      it('net delta decreased', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(1, 5), scaledBN(2, 7)], 0)

        await hedge(true)
      })

      it('short future & long squared', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-1, 5), scaledBN(2, 7)], 0)

        await hedge(true)
      })

      it('long future & short squared', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(1, 5), scaledBN(-2, 7)], 0)

        await hedge(false)
      })
    })
  })
})
