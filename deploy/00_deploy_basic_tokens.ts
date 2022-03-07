import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { networkNameToWETH, networkNameToUSDC } from '../tasks/utils'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  console.log(`Start deploying with ${deployer}`)

  const { deploy } = deployments

  // Deploy WETH9
  const wethAddress = networkNameToWETH(network.name as string)
  if (wethAddress === undefined) {
    await deploy('MockERC20', { from: deployer, args: ['MockWETH predy', 'WETH', 18] })
    const weth = await ethers.getContract('MockERC20', deployer)
    console.log(`WETH Deployed at ${weth.address}`)

    const tx = await weth.mint(deployer, '1000000000000000000000000')
    await tx.wait()
  } else {
    console.log(`Using WETH at ${wethAddress}`)
  }

  // Deploy USDC
  const usdcAddress = networkNameToUSDC(network.name as string)
  if (usdcAddress === undefined) {
    await deploy('MockERC20', { from: deployer, args: ['USDC', 'USDC', 6], skipIfAlreadyDeployed: false })
    const usdc = await ethers.getContract('MockERC20', deployer)
    console.log(`USDC Deployed at ${usdc.address}`)

    const tx = await usdc.mint(deployer, '1000000000000000')
    await tx.wait()
  } else {
    console.log(`Using USDC at ${usdcAddress}`)
  }
}

export default func
