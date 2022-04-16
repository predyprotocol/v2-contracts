import { expect } from 'chai'
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
import { increaseTime, scaledBN } from '../utils/helpers'
import { MAX_WITHDRAW_AMOUNT, MIN_MARGIN, SAFETY_PERIOD } from '../utils/constants'

describe('update-hedge', function () {
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
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('hedge', () => {
    const depositAmount = scaledBN(5000, 6)
    const initialSpotPrice = 1001

    beforeEach(async () => {
      await testContractHelper.updateSpot(scaledBN(initialSpotPrice, 8))

      await perpetualMarket.initialize(depositAmount, 100000)
    })

    afterEach(async () => {
      const pool0 = await testContractSet.perpetualMarketCore.pools(0)
      const pool1 = await testContractSet.perpetualMarketCore.pools(1)

      await testContractHelper.trade(
        wallet,
        1,
        [pool0.positionPerpetuals, pool1.positionPerpetuals],
        MAX_WITHDRAW_AMOUNT,
      )

      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      if (tokenAmounts[1].gt(0)) {
        await perpetualMarket.execHedge()
      }

      console.log('LPToken price', (await perpetualMarket.getLPTokenPrice(0)).toString())

      const totalLiquidity = await testContractSet.perpetualMarketCore.amountLiquidity()
      await perpetualMarket.withdraw(totalLiquidity.div(100))

      // check USDC is almost 0
      expect(await testContractSet.perpetualMarketCore.balanceOf(wallet.address)).to.be.lte(100)
    })

    async function show() {
      console.log(
        'amountsUsdc0',
        (await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0].toString(),
      )
      console.log(
        'amountsUsdc1',
        (await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[1].toString(),
      )
      console.log(
        'amountLockedLiquidity0',
        (await testContractSet.perpetualMarketCore.pools(0)).amountLockedLiquidity.toString(),
      )
      console.log(
        'amountLockedLiquidity1',
        (await testContractSet.perpetualMarketCore.pools(1)).amountLockedLiquidity.toString(),
      )
    }

    async function execHedge() {
      const tokenAmounts = await perpetualMarket.getTokenAmountForHedging()
      if (tokenAmounts[1].gt(0)) {
        await perpetualMarket.execHedge()
      }
    }

    async function getHedgePositionValue(spot: BigNumber) {
      const nettingInfo = await testContractSet.perpetualMarketCore.getNettingInfo()

      return nettingInfo.amountsUsdc[0]
        .add(nettingInfo.amountsUsdc[1])
        .add(nettingInfo.amountUnderlying.mul(spot).div(100000000))
    }

    async function testCase1(positions: BigNumber[], price: number) {
      await testContractHelper.trade(wallet, 0, positions, MIN_MARGIN)
      await execHedge()
      await testContractHelper.trade(wallet, 1, [positions[0].mul(-1).div(2), 0], 0)

      expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0]).to.be.lt(0)
      const totalLiquidity1 = await testContractSet.perpetualMarketCore.amountLiquidity()
      console.log('totalLiquidity', totalLiquidity1.toString())

      const locked = (await testContractSet.perpetualMarketCore.pools(0)).amountLockedLiquidity.add(
        (await testContractSet.perpetualMarketCore.pools(1)).amountLockedLiquidity,
      )

      await expect(perpetualMarket.withdraw(totalLiquidity1.sub(locked).div(100))).to.be.revertedWith('PMC0')

      // 10% down
      await testContractHelper.updateSpot(scaledBN(price, 8))

      await execHedge()

      expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0]).to.be.gt(0)

      await testContractHelper.trade(wallet, 1, [positions[0].mul(-1).div(2), 0], 0)

      await execHedge()

      await increaseTime(SAFETY_PERIOD)

      expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0]).to.be.eq(0)
    }

    it('check minus usdc', async () => {
      await testCase1([scaledBN(2, 8), BigNumber.from(0)], 900)
    })

    it('check minus usdc(price high)', async () => {
      await testCase1([scaledBN(2, 8), BigNumber.from(0)], 1100)
    })

    it('check minus usdc(short squared&low)', async () => {
      await testCase1([scaledBN(2, 8), scaledBN(-2, 8)], 900)
    })

    it('check minus usdc(short squared&high)', async () => {
      await testCase1([scaledBN(2, 8), scaledBN(-2, 8)], 1100)
    })

    it('no available liquidity', async () => {
      await testContractHelper.trade(wallet, 0, [scaledBN(4, 8), 0], MIN_MARGIN)
      await perpetualMarket.execHedge()
      await testContractHelper.trade(wallet, 1, [scaledBN(-38, 7), 0], 0)
      await testContractHelper.trade(wallet, 1, [scaledBN(38, 7), 0], 0)
    })

    describe('AMM state is "deltaMargin > 0 && hedgePosition < 0 && |deltaMargin| > |hedgePosition|"', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), BigNumber.from(0)], MIN_MARGIN)
        await execHedge()
        await testContractHelper.trade(wallet, 1, [scaledBN(-19, 7), 0], 0)

        expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0]).to.be.lt(0)
        const totalLiquidity1 = await testContractSet.perpetualMarketCore.amountLiquidity()
        console.log('totalLiquidity', totalLiquidity1.toString())

        const locked = (await testContractSet.perpetualMarketCore.pools(0)).amountLockedLiquidity.add(
          (await testContractSet.perpetualMarketCore.pools(1)).amountLockedLiquidity,
        )

        await expect(perpetualMarket.withdraw(totalLiquidity1.sub(locked).div(100))).to.be.revertedWith('PMC0')

        // 30% down
        await testContractHelper.updateSpot(scaledBN(700, 8))

        expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0].lt(0)).to.be.true
        expect((await getHedgePositionValue(scaledBN(700, 8))).lt(0)).to.be.true
      })

      it('long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('small long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(1, 7), 0], 0)
      })

      it('large long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(32, 7), 0], scaledBN(1000, 6))
      })

      it('long squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(5, 8)], 0)
      })

      it('short squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-5, 8)], 0)
      })

      it('price down', async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('price down', async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-5, 8)], 0)
      })

      it('price up', async () => {
        await testContractHelper.updateSpot(scaledBN(2001, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('price up', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
        await testContractHelper.updateSpot(scaledBN(2001, 8))
        await increaseTime(SAFETY_PERIOD)
      })

      it('with hedging', async () => {
        await execHedge()

        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('with short', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-5, 7), 0], 0)
      })
    })

    describe('AMM state is "deltaMargin > 0 && hedgePosition < 0 && |deltaMargin| > |hedgePosition|" with future and squared', () => {
      beforeEach(async () => {
        await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), scaledBN(1, 8)], MIN_MARGIN)
        await execHedge()
        await testContractHelper.trade(wallet, 1, [scaledBN(-26, 7), 0], 0)

        expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0]).to.be.lt(0)
        const totalLiquidity1 = await testContractSet.perpetualMarketCore.amountLiquidity()
        console.log('totalLiquidity', totalLiquidity1.toString())

        const locked = (await testContractSet.perpetualMarketCore.pools(0)).amountLockedLiquidity.add(
          (await testContractSet.perpetualMarketCore.pools(1)).amountLockedLiquidity,
        )

        await expect(perpetualMarket.withdraw(totalLiquidity1.sub(locked).div(100))).to.be.revertedWith('PMC0')

        // 50% down
        const spot = 500
        await testContractHelper.updateSpot(scaledBN(spot, 8))

        await show()
        console.log((await getHedgePositionValue(scaledBN(spot, 8))).toString())

        expect((await testContractSet.perpetualMarketCore.getNettingInfo()).amountsUsdc[0].lt(0)).to.be.true
        expect((await getHedgePositionValue(scaledBN(spot, 8))).lt(0)).to.be.true
      })

      it('long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(26, 7), 0], scaledBN(1000, 6))
      })

      it('small long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(1, 7), 0], 0)
      })

      it('large long', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(32, 7), 0], scaledBN(1000, 6))
      })

      it('long squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(5, 8)], 0)
      })

      it('short squared', async () => {
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-5, 8)], 0)
      })

      it('price down', async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('price down', async () => {
        await testContractHelper.updateSpot(scaledBN(100, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [0, scaledBN(-5, 8)], 0)
      })

      it('price up', async () => {
        await testContractHelper.updateSpot(scaledBN(2001, 8))
        await increaseTime(SAFETY_PERIOD)
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('price up', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
        await testContractHelper.updateSpot(scaledBN(2001, 8))
        await increaseTime(SAFETY_PERIOD)
      })

      it('with hedging', async () => {
        await execHedge()

        await testContractHelper.trade(wallet, 1, [scaledBN(19, 7), 0], 0)
      })

      it('with short', async () => {
        await testContractHelper.trade(wallet, 1, [scaledBN(-5, 7), 0], 0)
      })
    })

    describe('complicated case', () => {
      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(3000, 8))
        await perpetualMarket.deposit(scaledBN(15000, 6))
        await testContractHelper.trade(wallet, 0, [scaledBN(2, 8), scaledBN(3, 8)], scaledBN(50000, 6))
        await execHedge()
      })

      it('case 1', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-2, 8), 0], 0)

        await execHedge()
        await show()

        await testContractHelper.updateSpot(scaledBN(3123, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(21, 7), scaledBN(-31, 7)], 0)

        await show()

        await testContractHelper.updateSpot(scaledBN(3237, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-21, 7), scaledBN(57, 7)], 0)

        await show()
        await execHedge()
      })

      it('case 2', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-2, 8), 0], 0)

        await show()

        await testContractHelper.updateSpot(scaledBN(2123, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(21, 7), scaledBN(-31, 7)], 0)

        await show()

        await testContractHelper.updateSpot(scaledBN(1236, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-21, 7), scaledBN(57, 7)], 0)

        await show()
        await execHedge()
      })

      it('case 3', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-2, 8), 0], 0)

        await testContractHelper.updateSpot(scaledBN(2123, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(21, 7), scaledBN(-31, 7)], 0)

        await testContractHelper.updateSpot(scaledBN(1237, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-21, 7), scaledBN(1, 7)], 0)

        await execHedge()
      })

      it('case 4', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [scaledBN(-3, 8), 0], 0)

        await execHedge()

        await testContractHelper.updateSpot(scaledBN(1615, 8))
        await increaseTime(SAFETY_PERIOD)

        await testContractHelper.trade(wallet, 1, [0, scaledBN(1, 8)], 0)
      })
    })

    describe('edge case', () => {
      beforeEach(async () => {
        await testContractHelper.updateSpot(scaledBN(3000, 8))
        await perpetualMarket.deposit(scaledBN(15000, 6))
      })

      it('trade 1', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))

        await testContractHelper.trade(wallet, 0, [1, 1], MIN_MARGIN)

        await execHedge()
      })

      it('trade -1', async () => {
        await testContractHelper.updateSpot(scaledBN(3012, 8))

        await testContractHelper.trade(wallet, 0, [-1, -1], MIN_MARGIN)

        await execHedge()
      })
    })
  })
})
