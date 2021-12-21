import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import {
  TradeWrapper,
  PerpetualMarket,
  LiquidityPool,
  MockERC20,
  MockWETH,
  MockChainlinkAggregator
} from '../../typechain'

export type TestContractSet = {
  aggregator: MockChainlinkAggregator
  tradeWrapper: TradeWrapper
  perpetualMarket: PerpetualMarket
  liquidityPool: LiquidityPool
  usdc: MockERC20
  weth: MockWETH
}

/**
 * contract helper
 */
export class TestContractHelper {
  testContractSet: TestContractSet

  constructor(testContractSet: TestContractSet) {
    this.testContractSet = testContractSet
  }

  async updateRoundData(roundId: number, spot: BigNumberish) {
    await this.testContractSet.aggregator.setLatestRoundData(roundId, spot)
  }

  async updateSpot(spot: BigNumberish) {
    await this.updateRoundData(0, spot)
  }

  async openLong(wallet: Wallet, vaultId: BigNumberish, size: BigNumberish, depositAmount: BigNumberish) {
    await this.testContractSet.tradeWrapper.connect(wallet).openPositions({ vaultId, sizes: [size, 0], depositOrWithdrawAmount: depositAmount })
  }

  async openShort(wallet: Wallet, vaultId: BigNumberish, size: BigNumberish, depositAmount: BigNumberish) {
    await this.testContractSet.tradeWrapper.connect(wallet).openPositions({ vaultId, sizes: [BigNumber.from(size).mul(-1), 0], depositOrWithdrawAmount: depositAmount })
  }
}

export async function deployTestContractSet(wallet: Wallet): Promise<TestContractSet> {
  const MockWETH = await ethers.getContractFactory('MockWETH')
  const MockERC20 = await ethers.getContractFactory('MockERC20')

  const weth = (await MockWETH.deploy('WETH', 'WETH', 18)) as MockWETH
  const usdc = (await MockERC20.deploy('USDC', 'USDC', 6)) as MockERC20

  const MockChainlinkAggregator = await ethers.getContractFactory('MockChainlinkAggregator')
  const aggregator = (await MockChainlinkAggregator.deploy()) as MockChainlinkAggregator

  const Hedging = await ethers.getContractFactory('Hedging')
  const hedging = (await Hedging.deploy())

  const FeeLevel = await ethers.getContractFactory('FeeLevel')
  const feeLevel = (await FeeLevel.deploy())

  const LiquidityPool = await ethers.getContractFactory('LiquidityPool')

  const liquidityPool = (await LiquidityPool.deploy(usdc.address, weth.address)) as LiquidityPool

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket', {
    libraries: {
      Hedging: hedging.address,
      FeeLevel: feeLevel.address
    },
  })

  const perpetualMarket = (await PerpetualMarket.deploy(liquidityPool.address, aggregator.address)) as PerpetualMarket

  const TradeWrapper = await ethers.getContractFactory('TradeWrapper')
  const tradeWrapper = (await TradeWrapper.deploy(perpetualMarket.address, liquidityPool.address)) as TradeWrapper

  return {
    weth,
    usdc,
    aggregator,
    liquidityPool,
    perpetualMarket,
    tradeWrapper
  }
}

export function send(method: string, params?: Array<any>) {
  return ethers.provider.send(method, params === undefined ? [] : params)
}

export function mineBlock() {
  return send('evm_mine', [])
}

/**
 * take a snapshot and return id
 * @returns snapshot id
 */
export async function takeSnapshot(): Promise<number> {
  const result = await send('evm_snapshot')
  await mineBlock()
  return result
}

/**
 * restore snapshot by id
 * @param id snapshot id
 */
export async function restoreSnapshot(id: number) {
  await send('evm_revert', [id])
  await mineBlock()
}
