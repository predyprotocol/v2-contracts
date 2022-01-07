import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import {
  PerpetualMarket,
  PerpetualMarketCore,
  LiquidityPool,
  MockERC20,
  MockWETH,
  MockChainlinkAggregator
} from '../../typechain'
import { scaledBN } from './helpers'

export type TestContractSet = {
  aggregator: MockChainlinkAggregator
  perpetualMarket: PerpetualMarket
  perpetualMarketWithFunding: PerpetualMarket
  perpetualMarketCore: PerpetualMarketCore
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

  async openLong(wallet: Wallet, vaultId: BigNumberish, size: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).openPositions({ vaultId, sizes: [size, 0], imRatio: scaledBN(1, 8) })
  }

  async openShort(wallet: Wallet, vaultId: BigNumberish, size: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).openPositions({ vaultId, sizes: [BigNumber.from(size).mul(-1), 0], imRatio: scaledBN(1, 8) })
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

  const TradeStateLib = await ethers.getContractFactory('TradeStateLib')
  const tradeStateLib = (await TradeStateLib.deploy())

  const TraderVault = await ethers.getContractFactory('TraderVault')
  const traderVault = (await TraderVault.deploy())

  const LiquidityPool = await ethers.getContractFactory('LiquidityPool')

  const liquidityPool = (await LiquidityPool.deploy(usdc.address, weth.address)) as LiquidityPool

  const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore', {
    libraries: {
      Hedging: hedging.address,
      TradeStateLib: tradeStateLib.address,
      TraderVault: traderVault.address
    },
  })

  const perpetualMarketCore = (await PerpetualMarketCore.deploy(aggregator.address, false)) as PerpetualMarketCore
  const perpetualMarketCoreWithFunding = (await PerpetualMarketCore.deploy(aggregator.address, true)) as PerpetualMarketCore

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket')
  const perpetualMarket = (await PerpetualMarket.deploy(perpetualMarketCore.address, liquidityPool.address)) as PerpetualMarket
  const perpetualMarketWithFunding = (await PerpetualMarket.deploy(perpetualMarketCoreWithFunding.address, liquidityPool.address)) as PerpetualMarket

  await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)
  await perpetualMarketCoreWithFunding.setPerpetualMarket(perpetualMarketWithFunding.address)

  return {
    weth,
    usdc,
    aggregator,
    liquidityPool,
    perpetualMarketCore,
    perpetualMarket,
    perpetualMarketWithFunding
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
