import { ethers } from "hardhat";

async function main() {
  const signer = await ethers.getSigner('0x4f071924D66BBC71A5254217893CC7D49938B1c4')
  const network = await signer?.provider?.getNetwork()

  console.log('deployer: ', signer.address)

  if (network === undefined) {
    return
  }


  let aggregatorAddress
  let wethAddress
  let usdcAddress

  console.log(network.name)

  if (network.name === 'kovan') {
    // kovan
    aggregatorAddress = '0x9326BFA02ADD2366b30bacB125260Af641031331'
    wethAddress = '0xd0a1e359811322d97991e03f863a0c30c2cf029c'

    // replace to link address
    // aggregatorAddress = '0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0'
    // wethAddress = '0xAD5ce863aE3E4E9394Ab43d4ba0D80f419F61789'

    usdcAddress = '0xe22da380ee6b445bb8273c81944adeb6e8450422'
  } else if (network.name === 'rinkeby') {
    // rinkeby
    aggregatorAddress = '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e'
    wethAddress = '0xc778417e063141139fce010982780140aa0cd5ab'
    usdcAddress = '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b'
  } else if (network.name === 'homestead') {
    aggregatorAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
    wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  }

  if (usdcAddress === undefined || wethAddress === undefined || aggregatorAddress === undefined) {
    return
  }

  const Hedging = await ethers.getContractFactory('Hedging')
  const hedging = await Hedging.deploy()
  await hedging.deployed();
  console.log(`Hedging deployed to ${hedging.address}`)

  const TradeStateLib = await ethers.getContractFactory('TradeStateLib')
  const tradeStateLib = await TradeStateLib.deploy()
  await tradeStateLib.deployed();
  console.log(`TradeStateLib deployed to ${tradeStateLib.address}`)

  const TraderVault = await ethers.getContractFactory('TraderVault')
  const traderVault = await TraderVault.deploy()
  await traderVault.deployed();
  console.log(`TraderVault deployed to ${traderVault.address}`)

  const LiquidityPool = await ethers.getContractFactory('LiquidityPool')
  const liquidityPool = await LiquidityPool.deploy(usdcAddress, wethAddress)
  await tradeStateLib.deployed();
  console.log(`LiquidityPool deployed to ${liquidityPool.address}`)

  const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore', {
    libraries: {
      Hedging: hedging.address,
      TradeStateLib: tradeStateLib.address,
      TraderVault: traderVault.address,
    },
  })
  const perpetualMarketCore = await PerpetualMarketCore.deploy(aggregatorAddress, false)
  await perpetualMarketCore.deployed();
  console.log(`PerpetualMarketCore deployed to ${perpetualMarketCore.address}`)

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket')
  const perpetualMarket = await PerpetualMarket.deploy(
    perpetualMarketCore.address,
    liquidityPool.address,
  )
  await perpetualMarket.deployed();
  console.log(`PerpetualMarket deployed to ${perpetualMarket.address}`)

  await perpetualMarketCore.setPerpetualMarket(perpetualMarket.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
