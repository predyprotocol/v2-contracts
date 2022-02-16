import { BigNumber } from "ethers"

export const networkNameToUSDC = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xb8588b977F48c28f8eBfb12f48bC74cE7eAFA281'
    default: return undefined
  }
}

export const networkNameToWETH = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0x5D7E4863a7B312F4F8449FEC3d50b9Fc9068EC8E'
    default: return undefined
  }
}

export const networkNameToPerpetualMarket = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0x8Bb11fAD63a9FE4943b069d6e3E9bdb3b6Eb479d'
    default: return undefined
  }
}

export const networkNameToPerpetualMarketCore = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0x1925a0C30C1B56A0E0eBC7Bf9C8D11d854eC71Df'
    default: return undefined
  }
}

export const networkNameToFlashHedge = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xd8EaC40f5DCbd68fb7D6B9275C0b39c5ED8ae8bf'
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

export const getPerpetualMarketCore = async (ethers: any, deployer: string, networkName: string) => {
  const lpTokenAddress = networkNameToPerpetualMarketCore(networkName)
  if (lpTokenAddress === undefined) {
    return ethers.getContract("PerpetualMarketCore", deployer);
  }
  return ethers.getContractAt('PerpetualMarketCore', lpTokenAddress)
}

export const getFlashHedge = async (ethers: any, deployer: string, networkName: string) => {
  const flashHedgeAddress = networkNameToFlashHedge(networkName)
  if (flashHedgeAddress === undefined) {
    return ethers.getContract("FlashHedge", deployer);
  }
  return ethers.getContractAt('FlashHedge', flashHedgeAddress)
}

export const toUnscaled = (n: BigNumber, decimals: number) => {
  return n.toNumber() / BigNumber.from(10).pow(decimals).toNumber()
}
