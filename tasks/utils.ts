import { BigNumber } from "ethers"

export const networkNameToUSDC = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xb8588b977F48c28f8eBfb12f48bC74cE7eAFA281'
    default: return undefined
  }
}

export const networkNameToWETH = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xB47e6A5f8b33b3F17603C83a0535A9dcD7E32681'
    default: return undefined
  }
}

export const networkNameToPerpetualMarket = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xeEFc05223BA95Bc2a4b74daBe498B245c13DbBBF'
    default: return undefined
  }
}

export const networkNameToLPToken = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xff79e17bB23E8af2EA2f19504260aC6F85d2c032'
    default: return undefined
  }
}

export const getUSDC = async (ethers: any, deployer: string, networkName: string) => {
  const usdcAddress = networkNameToUSDC(networkName)
  if (usdcAddress === undefined) {
    // use to local deployment as USDC
    return ethers.getContract("MockERC20", deployer);
  }
  // get contract instance at address
  return ethers.getContractAt('MockERC20', usdcAddress)
}

export const getWETH = async (ethers: any, deployer: string, networkName: string) => {
  const wethAddress = networkNameToWETH(networkName)
  if (wethAddress === undefined) {
    return ethers.getContract("MockERC20", deployer);
  }
  // get contract instance at address
  return ethers.getContractAt('MockERC20', wethAddress)
}

export const getPerpetualMarket = async (ethers: any, deployer: string, networkName: string) => {
  const perpetualMarketAddress = networkNameToPerpetualMarket(networkName)
  if (perpetualMarketAddress === undefined) {
    return ethers.getContract("PerpetualMarket", deployer);
  }
  return ethers.getContractAt('PerpetualMarket', perpetualMarketAddress)
}

export const getLPToken = async (ethers: any, deployer: string, networkName: string) => {
  const lpTokenAddress = networkNameToLPToken(networkName)
  if (lpTokenAddress === undefined) {
    return ethers.getContract("LPToken", deployer);
  }
  return ethers.getContractAt('LPToken', lpTokenAddress)
}

export const toUnscaled = (n: BigNumber, decimals: number) => {
  return n.toNumber() / BigNumber.from(10).pow(decimals).toNumber()
}
