import { expect } from 'chai'
import { ethers } from 'hardhat'
import { FlashHedge, FlashHedge__factory, MockERC20, PerpetualMarket } from '../typechain'
import { constants, Contract, Wallet } from 'ethers'
import {
  createUniPool,
  deployTestContractSet,
  deployUniswapV3,
  restoreSnapshot,
  takeSnapshot,
  TestContractSet,
} from './utils/deploy'

describe('FlashHedge', function () {
  let wallet: Wallet, other: Wallet
  let weth: MockERC20
  let usdc: MockERC20

  let testContractSet: TestContractSet
  let snapshotId: number

  let perpetualMarket: PerpetualMarket

  let FlashHedge: FlashHedge__factory
  let uniswapFactory: Contract
  let ethUsdcPool: Contract

  const ethPriceInUSDC = 100

  before(async () => {
    ;[wallet, other] = await (ethers as any).getSigners()

    testContractSet = await deployTestContractSet(wallet)

    weth = testContractSet.weth
    usdc = testContractSet.usdc
    perpetualMarket = testContractSet.perpetualMarket

    // set up uniswap
    const result = await deployUniswapV3(weth)
    uniswapFactory = result.uniswapFactory

    ethUsdcPool = await createUniPool(ethPriceInUSDC, usdc, weth, result.positionManager, uniswapFactory, 500)
  })

  beforeEach(async () => {
    snapshotId = await takeSnapshot()

    FlashHedge = await ethers.getContractFactory('FlashHedge')
  })

  afterEach(async () => {
    await restoreSnapshot(snapshotId)
  })

  describe('constructor', () => {
    it('reverts if usdc address is zero', async () => {
      await expect(
        FlashHedge.deploy(
          constants.AddressZero,
          weth.address,
          perpetualMarket.address,
          uniswapFactory.address,
          ethUsdcPool.address,
        ),
      ).to.be.revertedWith('invalid collateral address')
    })

    it('reverts if weth address is zero', async () => {
      await expect(
        FlashHedge.deploy(
          usdc.address,
          constants.AddressZero,
          perpetualMarket.address,
          uniswapFactory.address,
          ethUsdcPool.address,
        ),
      ).to.be.revertedWith('invalid underlying address')
    })

    it('reverts if Perpetual Market address is zero', async () => {
      await expect(
        FlashHedge.deploy(
          usdc.address,
          weth.address,
          constants.AddressZero,
          uniswapFactory.address,
          ethUsdcPool.address,
        ),
      ).to.be.revertedWith('invalid perpetual market address')
    })

    it('reverts if Uniswap Factory address is zero', async () => {
      await expect(
        FlashHedge.deploy(
          usdc.address,
          weth.address,
          perpetualMarket.address,
          constants.AddressZero,
          ethUsdcPool.address,
        ),
      ).to.be.revertedWith('invalid factory address')
    })

    it('reverts if ETH-USDC pool address is zero', async () => {
      await expect(
        FlashHedge.deploy(
          usdc.address,
          weth.address,
          perpetualMarket.address,
          uniswapFactory.address,
          constants.AddressZero,
        ),
      ).to.be.revertedWith('invalid eth-usdc pool address')
    })
  })

  describe('setBot', () => {
    let flashHedeg: FlashHedge

    beforeEach(async () => {
      flashHedeg = await FlashHedge.deploy(
        usdc.address,
        weth.address,
        perpetualMarket.address,
        uniswapFactory.address,
        ethUsdcPool.address,
      )
    })

    it('set bot address', async () => {
      await flashHedeg.setBot(other.address)
    })

    it('reverts if caller is not owner', async () => {
      await expect(flashHedeg.connect(other).setBot(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
    })

    it('reverts if caller is not bot', async () => {
      await flashHedeg.setBot(other.address)

      await expect(flashHedeg.hedgeOnUniswap(0)).to.be.revertedWith('FH4')
    })
  })
})
