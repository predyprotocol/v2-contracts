import { ethers } from "hardhat";

async function main() {
  const signers = await ethers.getSigners()
  const signer = signers[0]
  const network = await signer.provider?.getNetwork()

  console.log('deployer: ', signer.address)

  if (network === undefined) {
    return
  }


  let priceFeedAddress
  let wethAddress
  let usdcAddress
  let feePoolAddress
  let uniswapFactoryAddress
  let ethUsdcPoolAddress

  let operatorAddress = '0x1c745d31A084a14Ba30E7c9F4B14EA762d44f194'

  console.log(network.name)

  if (network.name === 'kovan') {
    // kovan
    priceFeedAddress = '0x9326BFA02ADD2366b30bacB125260Af641031331'
    wethAddress = '0xd0a1e359811322d97991e03f863a0c30c2cf029c'

    // replace to link address
    // priceFeedAddress = '0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0'
    // wethAddress = '0xAD5ce863aE3E4E9394Ab43d4ba0D80f419F61789'

    usdcAddress = '0xe22da380ee6b445bb8273c81944adeb6e8450422'
    operatorAddress = signer.address
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    ethUsdcPoolAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
  } else if (network.name === 'rinkeby') {
    // rinkeby
    priceFeedAddress = '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e'
    wethAddress = '0xc778417e063141139fce010982780140aa0cd5ab'
    usdcAddress = '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b'
  } else if (network.name === 'homestead') {
    priceFeedAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
    wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    feePoolAddress = '0x66fBaAd82083716343B9413CAeB77aA13a8053a4'
  } else if (network.name === 'optimism') {
    priceFeedAddress = '0x13e3Ee699D1909E989722E753853AE30b17e08c5'
    wethAddress = '0x4200000000000000000000000000000000000006'
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'

  } else if (network.name === 'optimism-kovan') {
    priceFeedAddress = '0xCb7895bDC70A1a1Dce69b689FD7e43A627475A06'
    wethAddress = '0x4200000000000000000000000000000000000006'
    usdcAddress = '0x1147b3f6eca313a5b3c2aa3fb85928104a5787d3'
    operatorAddress = signer.address

    feePoolAddress = '0x60ff4F1977185263cC723F456CeF3Ca508E57d9f'
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
  } else if (network.name === 'arbitrum') {
    priceFeedAddress = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
    wethAddress = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    usdcAddress = '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
  } else if (network.name === 'arbitrum-rinkeby') {
    priceFeedAddress = '0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8'
    wethAddress = '0xB47e6A5f8b33b3F17603C83a0535A9dcD7E32681'
    // usdcAddress = '0xF49C3973edF5A39d619A0Aa2b7F1614d08df1ce3'
    usdcAddress = '0xb8588b977F48c28f8eBfb12f48bC74cE7eAFA281'
    feePoolAddress = '0x300Df3cD7DaCf191F6f7CECF3BCde535e2dd7e88'
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'

    operatorAddress = signer.address
  }

  if (usdcAddress === undefined) {
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    const usdc = await MockERC20.deploy('MockUSDC predy', 'USDC', 6)
    await usdc.deployed();
    usdcAddress = usdc.address
    console.log(`usdcAddress deployed to ${usdcAddress}`)

    const tx = await usdc.mint(operatorAddress, '1000000000000000')
    await tx.wait()
  }

  if (feePoolAddress === undefined && usdcAddress !== undefined) {
    const FeePool = await ethers.getContractFactory('FeePool')
    const feePool = await FeePool.deploy(usdcAddress)
    await feePool.deployed();
    feePoolAddress = feePool.address
    console.log(`feePoolAddress deployed to ${feePoolAddress}`)
  }

  if (usdcAddress === undefined
    || wethAddress === undefined
    || priceFeedAddress === undefined
    || feePoolAddress === undefined) {
    return
  }

  const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore')
  const perpetualMarketCore = await PerpetualMarketCore.deploy(priceFeedAddress)
  await perpetualMarketCore.deployed();
  console.log(`PerpetualMarketCore deployed to ${perpetualMarketCore.address}`)

  const TraderVaultLib = await ethers.getContractFactory('TraderVaultLib')
  const traderVaultLib = await TraderVaultLib.deploy()
  await traderVaultLib.deployed();

  console.log(`TraderVaultLib deployed to ${traderVaultLib.address}`)

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket', {
    libraries: {
      TraderVaultLib: traderVaultLib.address
    }
  })
  const perpetualMarket = await PerpetualMarket.deploy(
    perpetualMarketCore.address,
    usdcAddress,
    wethAddress,
    feePoolAddress
  )
  await perpetualMarket.deployed();
  console.log(`PerpetualMarket deployed to ${perpetualMarket.address}`)

  if (uniswapFactoryAddress !== undefined
    && ethUsdcPoolAddress !== undefined) {
    const FlashHedge = await ethers.getContractFactory('FlashHedge')
    const flashHedge = await FlashHedge.deploy(
      usdcAddress,
      wethAddress,
      perpetualMarket.address,
      uniswapFactoryAddress,
      ethUsdcPoolAddress
    )
    await flashHedge.deployed();
  }

  await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)

  await perpetualMarket.transferOwnership(operatorAddress)
  await perpetualMarketCore.transferOwnership(operatorAddress)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
