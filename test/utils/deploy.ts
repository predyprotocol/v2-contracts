import { BigNumber, BigNumberish, constants, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { PerpetualMarket, PerpetualMarketCore, MockERC20, MockWETH, MockChainlinkAggregator } from '../../typechain'
import { scaledBN } from './helpers'

export type TestContractSet = {
  priceFeed: MockChainlinkAggregator
  perpetualMarket: PerpetualMarket
  perpetualMarketCore: PerpetualMarketCore
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
    await this.testContractSet.priceFeed.setLatestRoundData(roundId, spot)
  }

  async updateSpot(spot: BigNumberish) {
    await this.updateRoundData(0, spot)
  }

  async openLong(wallet: Wallet, vaultId: BigNumberish, tradeAmount: BigNumberish, collateralRatio?: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).openPositions({
      vaultId,
      subVaultIndex: 0,
      tradeAmounts: [tradeAmount, 0],
      collateralRatio: collateralRatio || scaledBN(1, 8),
      limitPrices: [0, 0],
      deadline: 0,
    })
  }

  async openShort(wallet: Wallet, vaultId: BigNumberish, tradeAmount: BigNumberish, collateralRatio?: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).openPositions({
      vaultId,
      subVaultIndex: 0,
      tradeAmounts: [BigNumber.from(tradeAmount).mul(-1), 0],
      collateralRatio: collateralRatio || scaledBN(1, 8),
      limitPrices: [0, 0],
      deadline: 0,
    })
  }

  async getWithdrawalAmount(burnAmount: BigNumber, _withdrawnAmount: BigNumberish): Promise<BigNumber> {
    const withdrawnAmount = BigNumber.from(_withdrawnAmount)

    const lpTokenPrice = await this.testContractSet.perpetualMarket.getLPTokenPrice(withdrawnAmount.mul(-1))

    const nextWithdrawnAmount = lpTokenPrice.mul(burnAmount).div(scaledBN(1, 8))

    console.log('===')
    console.log('lpTokenPrice', lpTokenPrice.toString())
    console.log('withdrawnAmount', withdrawnAmount.toString())
    console.log('nextWithdrawnAmount', nextWithdrawnAmount.toString())
    console.log('===')

    if (withdrawnAmount.eq(nextWithdrawnAmount)) {
      return withdrawnAmount
    }

    return this.getWithdrawalAmount(burnAmount, nextWithdrawnAmount)
  }
}

export async function deployTestContractSet(wallet: Wallet): Promise<TestContractSet> {
  const MockWETH = await ethers.getContractFactory('MockWETH')
  const MockERC20 = await ethers.getContractFactory('MockERC20')

  const weth = (await MockWETH.deploy('WETH', 'WETH', 18)) as MockWETH
  const usdc = (await MockERC20.deploy('USDC', 'USDC', 6)) as MockERC20

  const MockChainlinkAggregator = await ethers.getContractFactory('MockChainlinkAggregator')
  const priceFeed = (await MockChainlinkAggregator.deploy()) as MockChainlinkAggregator

  const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore')
  const perpetualMarketCore = (await PerpetualMarketCore.deploy(priceFeed.address)) as PerpetualMarketCore

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket')
  const perpetualMarket = (await PerpetualMarket.deploy(
    perpetualMarketCore.address,
    usdc.address,
    weth.address,
  )) as PerpetualMarket

  await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)

  return {
    weth,
    usdc,
    priceFeed,
    perpetualMarket,
    perpetualMarketCore,
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
