import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { networkNameToUSDC, networkNameToFeePool, networkNameToOperator } from '../tasks/utils'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  console.log(`Start deploying with ${deployer}`)

  const { deploy } = deployments

  // Deploy FeePool
  const feePoolAddress = networkNameToFeePool(network.name as string)
  const usdcAddress = networkNameToUSDC(network.name as string)
  const operatorAddress = networkNameToOperator(network.name) || deployer

  if (usdcAddress === undefined) {
    console.log('USDC must not be undefined')
    return
  }

  if (feePoolAddress === undefined) {
    const result = await deploy('FeePool', { from: deployer, args: [usdcAddress] })
    const feePool = await ethers.getContract('FeePool', deployer)
    console.log(`FeePool Deployed at ${feePool.address}`)

    if (result.newlyDeployed) {
      await feePool.transferOwnership(operatorAddress)
    }
  } else {
    console.log(`Using FeePool at ${feePoolAddress}`)
  }
}

export default func
