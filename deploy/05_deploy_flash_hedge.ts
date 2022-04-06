import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { networkNameToUSDC, networkNameToWETH, networkNameToEthUsdcPool } from '../tasks/utils'

const uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  const { deploy } = deployments

  // Deploy FlashHedge
  const usdcAddress = networkNameToUSDC(network.name)
  const wethAddress = networkNameToWETH(network.name)
  const ethUsdcPoolAddress = networkNameToEthUsdcPool(network.name)

  const perpetualMarket = await ethers.getContract('PerpetualMarket', deployer)

  await deploy('FlashHedge', {
    from: deployer,
    args: [usdcAddress, wethAddress, perpetualMarket.address, uniswapFactoryAddress, ethUsdcPoolAddress],
  })
  const flashHedge = await ethers.getContract('FlashHedge', deployer)
  console.log(`FlashHedge Deployed at ${flashHedge.address}`)
}

export default func
