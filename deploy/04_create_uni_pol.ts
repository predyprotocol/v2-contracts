import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { networkNameToEthUsdcPool, networkNameToUSDC, networkNameToWETH } from '../tasks/utils'
import { addWethUsdcLiquidity, createUniPool } from '../test/utils/deploy'
import { BigNumber } from 'ethers'
import { MockERC20 } from '../typechain'

const uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const uniswapPositionManager = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
const ethPrice = 2800
const feeTier = 500

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  const ethUsdcPoolAddress = networkNameToEthUsdcPool(network.name)
  const usdcAddress = networkNameToUSDC(network.name)
  const wethAddress = networkNameToWETH(network.name)

  if (ethUsdcPoolAddress !== undefined) {
    console.log(`Using EthUsdcPoolAddress at ${ethUsdcPoolAddress}`)
    return
  }

  if (usdcAddress === undefined || wethAddress === undefined) {
    return
  }

  const usdc = await ethers.getContractAt('MockERC20', usdcAddress)
  const weth = await ethers.getContractAt('MockERC20', wethAddress)

  const uniswapV3Factory = await ethers.getContractAt('IUniswapV3Factory', uniswapFactoryAddress)
  const positionManager = await ethers.getContractAt('INonfungiblePositionManager', uniswapPositionManager)

  const pool = await createUniPool(ethPrice, weth, usdc, positionManager, uniswapV3Factory, feeTier)
  const wethAmount = '1000000000000000000000'

  const approveTx = await weth.approve(uniswapPositionManager, wethAmount)
  await approveTx.wait()

  await addWethUsdcLiquidity(
    ethPrice,
    BigNumber.from(wethAmount),
    deployer,
    usdc as MockERC20,
    weth as MockERC20,
    positionManager,
    feeTier,
  )

  console.log(`ethUsdcPoolAddress deployed to ${pool.address}`)
}

export default func
