import { BigNumber } from 'ethers'

export const networkNameToOperator = (name: string) => {
  switch (name) {
    case 'arbitrum':
      return '0xb8d843c8E6e0E90eD2eDe80550856b64da92ee30'
    default:
      return undefined
  }
}

export const networkNameToPriceFeed = (name: string) => {
  switch (name) {
    case 'localhost':
      return '0x27b097697883782dB1BDaF67d2c02D447F4390fF'
    case 'kovan':
      return '0x9326BFA02ADD2366b30bacB125260Af641031331'
    case 'rinkebyArbitrum':
      return '0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8'
    case 'arbitrum':
      return '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
    default:
      return undefined
  }
}

export const networkNameToFeePool = (name: string) => {
  switch (name) {
    case 'kovan':
      return '0xd180A1aD9eE1E975f29Cf9813B3946Bd897955c0'
    case 'rinkebyArbitrum':
      return '0x9c515225EAFC6207f56a751B8a992aFC5Fd45469'
    case 'arbitrum':
      return '0x7560f7a5d617B8bc9b8bAadA934659120561BaEA'
    default:
      return undefined
  }
}

export const networkNameToUSDC = (name: string) => {
  switch (name) {
    case 'localhost':
      return '0xbb493077FBB5bd227b596D5507d796D51FD135F0'
    case 'kovan':
      return '0xe22da380ee6b445bb8273c81944adeb6e8450422'
    case 'rinkebyArbitrum':
      return '0xF61Cffd6071a8DB7cD5E8DF1D3A5450D9903cF1c'
    case 'arbitrum':
      return '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'
    default:
      return undefined
  }
}

export const networkNameToWETH = (name: string) => {
  switch (name) {
    case 'localhost':
      return '0x85C5D18eA5b142B86283C364Fe50400528f3365d'
    case 'kovan':
      return '0xd0a1e359811322d97991e03f863a0c30c2cf029c'
    case 'rinkebyArbitrum':
      return '0xB47e6A5f8b33b3F17603C83a0535A9dcD7E32681'
    case 'arbitrum':
      return '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
    default:
      return undefined
  }
}

export const networkNameToPerpetualMarket = (name: string) => {
  switch (name) {
    case 'kovan':
      return '0x3A53C9e69950E8e2CDaC889E387fB182A009463D'
    case 'rinkebyArbitrum':
      return '0xc29d45982B10392D6D880d2a657685c326232Ce0'
    //case 'arbitrum':
    //  return '0x65737f365A46CF30b555C9216c8199929e902628'
    default:
      return undefined
  }
}

export const networkNameToPerpetualMarketCore = (name: string) => {
  switch (name) {
    case 'kovan':
      return '0xe0cdA1F5433409B08D6f28FBe4c5daad88D897f6'
    case 'rinkebyArbitrum':
      return '0x7f0209AAeC76fdDa476E3150ac338513C3101327'
    //case 'arbitrum':
    //  return '0x8FeEBd1fD65B6706B2837792C5DFA5B569c4cEA7'
    default:
      return undefined
  }
}

export const networkNameToFlashHedge = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum':
      return '0x947F7Ca69b2C85aa10b76D9f981Ce38090f174C3'
    //case 'arbitrum':
    // return '0xfBe077eFaEF9093C30DC7e06Bc7Eb0b48963bE5A'
    default:
      return undefined
  }
}

export const networkNameToVaultNFT = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum':
      return '0x67C0B488a141B2a52554A13D8F66BE47b7A7aa3E'
    //case 'arbitrum':
    //  return '0xBb87A1011d643362EE92a043EfA8196F6413bbB4'
    default:
      return undefined
  }
}

export const networkNameToEthUsdcPool = (name: string) => {
  switch (name) {
    case 'rinkebyArbitrum':
      return '0xA3180E86A1B2273e654e885323cCCd30A5cB4c95'
    case 'arbitrum':
      return '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443'
    default:
      return undefined
  }
}

export const getPriceFeed = async (ethers: any, deployer: string, networkName: string) => {
  const usdcAddress = networkNameToPriceFeed(networkName)
  if (usdcAddress === undefined) {
    // use to local deployment as USDC
    return ethers.getContract('AggregatorV3Interface', deployer)
  }
  // get contract instance at address
  return ethers.getContractAt('AggregatorV3Interface', usdcAddress)
}

export const getUSDC = async (ethers: any, deployer: string, networkName: string) => {
  const usdcAddress = networkNameToUSDC(networkName)
  if (usdcAddress === undefined) {
    // use to local deployment as USDC
    return ethers.getContract('MockERC20', deployer)
  }
  // get contract instance at address
  return ethers.getContractAt('MockERC20', usdcAddress)
}

export const getWETH = async (ethers: any, deployer: string, networkName: string) => {
  const wethAddress = networkNameToWETH(networkName)
  if (wethAddress === undefined) {
    return ethers.getContract('MockERC20', deployer)
  }
  // get contract instance at address
  return ethers.getContractAt('MockERC20', wethAddress)
}

export const getPerpetualMarket = async (ethers: any, deployer: string, networkName: string) => {
  const perpetualMarketAddress = networkNameToPerpetualMarket(networkName)
  if (perpetualMarketAddress === undefined) {
    return ethers.getContract('PerpetualMarket', deployer)
  }
  return ethers.getContractAt('PerpetualMarket', perpetualMarketAddress)
}

export const getPerpetualMarketCore = async (ethers: any, deployer: string, networkName: string) => {
  const lpTokenAddress = networkNameToPerpetualMarketCore(networkName)
  if (lpTokenAddress === undefined) {
    return ethers.getContract('PerpetualMarketCore', deployer)
  }
  return ethers.getContractAt('PerpetualMarketCore', lpTokenAddress)
}

export const getFlashHedge = async (ethers: any, deployer: string, networkName: string) => {
  const flashHedgeAddress = networkNameToFlashHedge(networkName)
  if (flashHedgeAddress === undefined) {
    return ethers.getContract('FlashHedge', deployer)
  }
  return ethers.getContractAt('FlashHedge', flashHedgeAddress)
}

export const getVaultNFT = async (ethers: any, deployer: string, networkName: string) => {
  const vaultNFTAddress = networkNameToVaultNFT(networkName)
  if (vaultNFTAddress === undefined) {
    return ethers.getContract('VaultNFT', deployer)
  }
  return ethers.getContractAt('VaultNFT', vaultNFTAddress)
}

export const toUnscaled = (n: BigNumber, decimals: number) => {
  return n.toNumber() / BigNumber.from(10).pow(decimals).toNumber()
}
