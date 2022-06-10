import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { networkNameToPriceFeed } from '../tasks/utils'

const lpTokenName = 'Predy V2 ETH USDC LP Token'
const lpTokenSymbol = 'PREDY2-ETH-USDC-LP'
const vaultTokenName = 'pVault'
const vaultTokenSymbol = 'PVAULT'

function getVaultTokenBaseURI(network: string) {
  switch (network) {
    case 'rinkebyArbitrum':
      return 'https://metadata.predy.finance/rinkeby-arbitrum/'
    case 'arbitrum':
      return 'https://metadata.predy.finance/arbitrum/'
    default:
      return undefined
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre
  const { deployer } = await getNamedAccounts()

  const { deploy } = deployments

  let priceFeedAddress = networkNameToPriceFeed(network.name as string)

  if (priceFeedAddress === undefined) {
    await deploy('MockChainlinkAggregator', { from: deployer })
    const priceFeed = await ethers.getContract('MockChainlinkAggregator', deployer)
    priceFeedAddress = priceFeed.address
    console.log(`MockChainlinkAggregator Deployed at ${priceFeedAddress}`)
  }

  const result = await deploy('PerpetualMarketCore', {
    from: deployer,
    args: [priceFeedAddress, lpTokenName, lpTokenSymbol],
    log: true,
  })
  await deploy('TraderVaultLib', { from: deployer, log: true })
  const baseUri = getVaultTokenBaseURI(network.name)
  console.log('baseUri', baseUri)
  await deploy('VaultNFT', { from: deployer, args: [vaultTokenName, vaultTokenSymbol, baseUri], log: true })

  if (result.newlyDeployed) {
    const perpetualMarketCore = await ethers.getContract('PerpetualMarketCore', deployer)

    // set SquaredPerpFundingMultiplier as 690%
    await perpetualMarketCore.setSquaredPerpFundingMultiplier(690000000)
    // set PerpFutureMaxFundingRate as 0.69%
    await perpetualMarketCore.setPerpFutureMaxFundingRate(690000)
    // set risk parameter as 40%
    await perpetualMarketCore.setPoolMarginRiskParam(4000)
    // trade fee is 0.05% and protocol fee is 0.01%
    await perpetualMarketCore.setTradeFeeRate(50000, 10000)
    // hedge slippage 0.34%-0.48%
    await perpetualMarketCore.setHedgeParams(34, 48, 5000000)
  }
}

export default func
