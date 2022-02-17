import { BigNumber } from "ethers"
import { PerpetualMarket } from "../typechain"

export const networkNameToUSDC = (name: string) => {
  switch (name) {
    case 'kovan': return '0xe22da380ee6b445bb8273c81944adeb6e8450422'
    case 'rinkebyArbitrum': return '0xb8588b977F48c28f8eBfb12f48bC74cE7eAFA281'
    default: return undefined
  }
}

export const networkNameToWETH = (name: string) => {
  switch (name) {
    case 'kovan': return '0xd0a1e359811322d97991e03f863a0c30c2cf029c'
    case 'rinkebyArbitrum': return '0x5D7E4863a7B312F4F8449FEC3d50b9Fc9068EC8E'
    default: return undefined
  }
}

export const networkNameToPerpetualMarket = (name: string) => {
  switch (name) {
    case 'kovan': return '0x3A53C9e69950E8e2CDaC889E387fB182A009463D'
    case 'rinkebyArbitrum': return '0x1A053d06058648CCdf158b9d1cB64C16690E84Cf'
    default: return undefined
  }
}

export const networkNameToPerpetualMarketCore = (name: string) => {
  switch (name) {
    case 'kovan': return '0xe0cdA1F5433409B08D6f28FBe4c5daad88D897f6'
    case 'rinkebyArbitrum': return '0x99aA8873104d04484881Ea75B3431bC99d325EdD'
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
    return ethers.getContract("PerpetualMarket", deployer) as PerpetualMarket
  }
  return ethers.getContractAt('PerpetualMarket', perpetualMarketAddress) as PerpetualMarket
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
