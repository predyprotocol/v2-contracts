import { BigNumber } from "ethers"

export const networkNameToPriceFeed = (name: string) => {
  switch (name) {
    case 'kovan': return '0x9326BFA02ADD2366b30bacB125260Af641031331'
    case 'rinkebyArbitrum': return '0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8'
    default: return undefined
  }
}

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
    case 'rinkebyArbitrum': return '0x9A2C5809c3987081F2c6a524aa0B29B15afDA2D4'
    default: return undefined
  }
}

export const networkNameToPerpetualMarketCore = (name: string) => {
  switch (name) {
    case 'kovan': return '0xe0cdA1F5433409B08D6f28FBe4c5daad88D897f6'
    case 'rinkebyArbitrum': return '0xa9cDeABe33b1CfE3a3C29Ba1ccaBF94A25c63078'
    default: return undefined
  }
}

export const networkNameToFlashHedge = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0xd8EaC40f5DCbd68fb7D6B9275C0b39c5ED8ae8bf'
    default: return undefined
  }
}

export const networkNameToVaultNFT = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum': return '0x963c02379c63452f7DBc0f0160e19F73e0A2500D'
    default: return undefined
  }
}

export const getPriceFeed = async (ethers: any, deployer: string, networkName: string) => {
  const usdcAddress = networkNameToPriceFeed(networkName)
  if (usdcAddress === undefined) {
    // use to local deployment as USDC
    return ethers.getContract("AggregatorV3Interface", deployer)
  }
  // get contract instance at address
  return ethers.getContractAt('AggregatorV3Interface', usdcAddress)
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
    return ethers.getContract("PerpetualMarket", deployer)
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

export const getVaultNFT = async (ethers: any, deployer: string, networkName: string) => {
  const vaultNFTAddress = networkNameToVaultNFT(networkName)
  if (vaultNFTAddress === undefined) {
    return ethers.getContract("VaultNFT", deployer);
  }
  return ethers.getContractAt('VaultNFT', vaultNFTAddress)
}

export const toUnscaled = (n: BigNumber, decimals: number) => {
  return n.toNumber() / BigNumber.from(10).pow(decimals).toNumber()
}
