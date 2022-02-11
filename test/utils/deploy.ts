import { BigNumber, BigNumberish, Contract, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import {
  MockFeePool,
  FlashHedge,
  PerpetualMarket,
  PerpetualMarketCore,
  MockERC20,
  MockWETH,
  MockChainlinkAggregator,
  IFeePool,
  LPToken,
} from '../../typechain'
import { scaledBN } from './helpers'
import {
  abi as SWAP_ROUTER_ABI,
  bytecode as SWAP_ROUTER_BYTECODE,
} from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'
import {
  abi as POSITION_MANAGER_ABI,
  bytecode as POSITION_MANAGER_BYTECODE,
} from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import { convertToken0PriceToSqrtX96Price, convertToken1PriceToSqrtX96Price } from './calculator'
import { INonfungiblePositionManager } from '../../typechain/INonfungiblePositionManager'

export type TestContractSet = {
  priceFeed: MockChainlinkAggregator
  perpetualMarket: PerpetualMarket
  perpetualMarketCore: PerpetualMarketCore
  feePool: IFeePool
  lpToken: LPToken
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

  async openLong(wallet: Wallet, vaultId: BigNumberish, tradeAmount: BigNumberish, collateralAmount?: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).trade({
      vaultId,
      subVaultIndex: 0,
      tradeAmounts: [tradeAmount, 0],
      collateralAmount: collateralAmount || 0,
      limitPrices: [0, 0],
      deadline: 0,
    })
  }

  async openShort(wallet: Wallet, vaultId: BigNumberish, tradeAmount: BigNumberish, collateralAmount?: BigNumberish) {
    await this.testContractSet.perpetualMarket.connect(wallet).trade({
      vaultId,
      subVaultIndex: 0,
      tradeAmounts: [BigNumber.from(tradeAmount).mul(-1), 0],
      collateralAmount: collateralAmount || 0,
      limitPrices: [0, 0],
      deadline: 0,
    })
  }

  async getWithdrawalAmount(burnAmount: BigNumber, _withdrawnAmount: BigNumberish): Promise<BigNumber> {
    const withdrawnAmount = BigNumber.from(_withdrawnAmount)

    const lpTokenPrice = await this.testContractSet.perpetualMarket.getLPTokenPrice(withdrawnAmount.mul(-1))

    const nextWithdrawnAmount = lpTokenPrice.mul(burnAmount).div(scaledBN(1, 16))

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

  const MockFeePool = await ethers.getContractFactory('MockFeePool')
  const mockFeePool = (await MockFeePool.deploy(usdc.address)) as MockFeePool

  const LPToken = await ethers.getContractFactory('LPToken')
  const lpToken = (await LPToken.deploy()) as LPToken

  const TraderVaultLib = await ethers.getContractFactory('TraderVaultLib')
  const traderVaultLib = await TraderVaultLib.deploy()

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket', {
    libraries: {
      TraderVaultLib: traderVaultLib.address,
    },
  })
  const perpetualMarket = (await PerpetualMarket.deploy(
    perpetualMarketCore.address,
    lpToken.address,
    usdc.address,
    weth.address,
    mockFeePool.address,
  )) as PerpetualMarket

  await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)
  await lpToken.setPerpetualMarket(perpetualMarket.address)

  return {
    weth,
    usdc,
    priceFeed,
    perpetualMarket,
    perpetualMarketCore,
    lpToken,
    feePool: mockFeePool,
  }
}

export async function deployFlashHedge(
  weth: Contract,
  usdc: Contract,
  perpetualMarket: Contract,
  uniswapFactory: Contract,
  positionManager: Contract,
  ethUsdcPool: Contract,
) {
  const FlashHedge = await ethers.getContractFactory('FlashHedge')
  const flashHedge = (await FlashHedge.deploy(
    usdc.address,
    weth.address,
    perpetualMarket.address,
    uniswapFactory.address,
    ethUsdcPool.address,
  )) as FlashHedge

  return flashHedge
}

// Functions to setting up Uniswap V3 contracts
// These functions from https://github.com/opynfinance/squeeth-monorepo/blob/main/packages/hardhat/test/setup.ts

/**
 * Deploys Position Manager, Uniswap Factory and Swap Router
 * @param weth WETH contract
 * @returns
 */
export async function deployUniswapV3(weth: Contract) {
  const accounts = await ethers.getSigners()

  // Deploy UniswapV3Factory
  const UniswapV3FactoryFactory = new ethers.ContractFactory(FACTORY_ABI, FACTORY_BYTECODE, accounts[0])
  const uniswapFactory = await UniswapV3FactoryFactory.deploy()

  // Deploy UniswapV3SwapRouter
  const SwapRouterFactory = new ethers.ContractFactory(SWAP_ROUTER_ABI, SWAP_ROUTER_BYTECODE, accounts[0])
  const swapRouter = await SwapRouterFactory.deploy(uniswapFactory.address, weth.address)

  // tokenDescriptor is only used to query tokenURI() on NFT. Don't need that in our deployment
  const tokenDescriptorAddress = ethers.constants.AddressZero
  // Deploy NonfungibleTokenManager
  const positionManagerFactory = new ethers.ContractFactory(
    POSITION_MANAGER_ABI,
    POSITION_MANAGER_BYTECODE,
    accounts[0],
  )
  const positionManager = await positionManagerFactory.deploy(
    uniswapFactory.address,
    weth.address,
    tokenDescriptorAddress,
  )

  return { positionManager, uniswapFactory, swapRouter }
}

/**
 * Creates Uniswap Pool
 * @param tokenBPriceInA
 * @param tokenA
 * @param tokenB
 * @param positionManager
 * @param univ3Factory
 * @param feeTier
 * @returns pool contract
 */
export async function createUniPool(
  tokenBPriceInA: number,
  tokenA: Contract,
  tokenB: Contract,
  positionManager: Contract,
  univ3Factory: Contract,
  feeTier = 3000,
): Promise<Contract> {
  const isTokenAToken0 = parseInt(tokenA.address, 16) < parseInt(tokenB.address, 16)

  const tokenADecimals = await tokenA.decimals()
  const tokenBDecimals = await tokenB.decimals()

  let rawPrice = tokenBPriceInA

  if (tokenBDecimals > tokenADecimals) {
    const diff = tokenBDecimals - tokenADecimals
    rawPrice /= 10 ** diff
  } else {
    const diff = tokenADecimals - tokenBDecimals
    rawPrice *= 10 ** diff
  }

  const sqrtX96Price = isTokenAToken0
    ? convertToken1PriceToSqrtX96Price(rawPrice.toString()).toFixed(0)
    : convertToken0PriceToSqrtX96Price(rawPrice.toString()).toFixed(0)

  const token0Addr = isTokenAToken0 ? tokenA.address : tokenB.address
  const token1Addr = isTokenAToken0 ? tokenB.address : tokenA.address

  const poolAddrFirstTry = await univ3Factory.getPool(token0Addr, token1Addr, feeTier)
  if (poolAddrFirstTry !== ethers.constants.AddressZero) {
    return ethers.getContractAt('IUniswapV3Pool', poolAddrFirstTry)
  }

  const tx = await positionManager.createAndInitializePoolIfNecessary(token0Addr, token1Addr, feeTier, sqrtX96Price)
  await tx.wait()

  const poolAddr = await univ3Factory.getPool(token0Addr, token1Addr, feeTier)
  const pool = await ethers.getContractAt('IUniswapV3Pool', poolAddr)

  return pool
}

/**
 * Adds liquidity to ETH/USDC pool
 * @param ethPrice
 * @param ethAmount
 * @param deployer
 * @param usdc
 * @param weth
 * @param positionManager
 * @param feeTier
 * @returns tokenId of Position NFT
 */
export const addWethUsdcLiquidity = async (
  ethPrice: number,
  ethAmount: BigNumber,
  deployer: string,
  usdc: MockERC20,
  weth: MockERC20,
  positionManager: Contract,
  feeTier = 3000,
) => {
  const isWethToken0 = parseInt(weth.address, 16) < parseInt(usdc.address, 16)

  const token0 = isWethToken0 ? weth.address : usdc.address
  const token1 = isWethToken0 ? usdc.address : weth.address

  const usdcAmount = BigNumber.from(ethAmount.toString()).mul(ethPrice).div(scaledBN(1, 12))

  await usdc.approve(positionManager.address, ethers.constants.MaxUint256)
  await weth.approve(positionManager.address, ethers.constants.MaxUint256)

  const mintParam = {
    token0,
    token1,
    fee: feeTier,
    tickLower: -887220, // int24 min tick used when selecting full range
    tickUpper: 887220, // int24 max tick used when selecting full range
    amount0Desired: isWethToken0 ? ethAmount.toString() : usdcAmount.toString(),
    amount1Desired: isWethToken0 ? usdcAmount.toString() : ethAmount.toString(),
    amount0Min: 1,
    amount1Min: 1,
    recipient: deployer, // address
    deadline: Math.floor((await getNow(ethers.provider)) + 8640000), // uint256
  }

  const tx = await (positionManager as INonfungiblePositionManager).mint(mintParam)
  const receipt = await tx.wait()
  const tokenId: BigNumber = receipt.events?.find((event) => event.event === 'IncreaseLiquidity')?.args?.tokenId

  return tokenId.toNumber()
}

export const getNow = async (provider: any) => {
  const blockNumBefore = await provider.getBlockNumber()
  const blockBefore = await provider.getBlock(blockNumBefore)
  return blockBefore.timestamp
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
