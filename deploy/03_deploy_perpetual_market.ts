import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { networkNameToUSDC, networkNameToWETH, networkNameToOperator } from '../tasks/utils'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  const { deploy } = deployments

  // Deploy PerpetualMarket
  const usdcAddress = networkNameToUSDC(network.name)
  const wethAddress = networkNameToWETH(network.name)
  const operatorAddress = networkNameToOperator(network.name) || deployer

  const feePool = await ethers.getContract('FeePool', deployer)
  const perpetualMarketCore = await ethers.getContract('PerpetualMarketCore', deployer)
  const vaultNFT = await ethers.getContract('VaultNFT', deployer)
  const TraderVaultLib = await ethers.getContract('TraderVaultLib', deployer)

  if (usdcAddress === undefined) {
    console.log('USDC must not be undefined')
    return
  }

  const result = await deploy('PerpetualMarket', {
    from: deployer,
    args: [perpetualMarketCore.address, usdcAddress, wethAddress, feePool.address, vaultNFT.address],
    libraries: {
      TraderVaultLib: TraderVaultLib.address,
    },
  })
  if (result.newlyDeployed) {
    const perpetualMarket = await ethers.getContract('PerpetualMarket', deployer)
    console.log(`PerpetualMarket Deployed at ${perpetualMarket.address}`)

    await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)
    await vaultNFT.init(perpetualMarket.address)

    // Set Max Amount as 150
    await perpetualMarket.setMaxAmount('15000000000', '15000000000')

    await perpetualMarketCore.transferOwnership(operatorAddress)
  }
}

export default func
