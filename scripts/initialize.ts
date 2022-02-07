import { BigNumber, BigNumberish } from "ethers";
import { ethers } from "hardhat";

async function main() {
  const signers = await ethers.getSigners()
  const signer = signers[0]
  const network = await signer.provider?.getNetwork()

  console.log('deployer: ', signer.address)

  if (network === undefined) {
    return
  }


  let aggregatorAddress
  let wethAddress
  let usdcAddress
  let feePoolAddress
  let uniswapFactoryAddress
  let ethUsdcPoolAddress
  let perpetualMarketAddress
  let perpetualMarketCoreAddress

  let operatorAddress = '0x1c745d31A084a14Ba30E7c9F4B14EA762d44f194'

  console.log(network.name)

  if (network.name === 'kovan') {
    // kovan
    aggregatorAddress = '0x9326BFA02ADD2366b30bacB125260Af641031331'
    wethAddress = '0xd0a1e359811322d97991e03f863a0c30c2cf029c'

    // replace to link address
    // aggregatorAddress = '0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0'
    // wethAddress = '0xAD5ce863aE3E4E9394Ab43d4ba0D80f419F61789'

    usdcAddress = '0xe22da380ee6b445bb8273c81944adeb6e8450422'
    operatorAddress = signer.address
    uniswapFactoryAddress = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
    ethUsdcPoolAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
    feePoolAddress = '0x7ddf1C3398911fe64459162269ECaB50235e1594'

    perpetualMarketAddress = '0xEeE521668253c9394bde99B0BA5970b0f15Dd6e9'
    perpetualMarketCoreAddress = '0x69498D8328889679714552856974B35b4ab483A1'
  } else if (network.name === 'optimism') {
    aggregatorAddress = '0x13e3Ee699D1909E989722E753853AE30b17e08c5'

  } else if (network.name === 'optimism-kovan') {
    aggregatorAddress = '0xCb7895bDC70A1a1Dce69b689FD7e43A627475A06'
    wethAddress = '0x4200000000000000000000000000000000000006'
    usdcAddress = '0x1147b3f6eca313a5b3c2aa3fb85928104a5787d3'
    operatorAddress = signer.address

    feePoolAddress = '0x60ff4F1977185263cC723F456CeF3Ca508E57d9f'

    /*
    const FeePool = await ethers.getContractFactory('FeePool')
    const feePool = await FeePool.deploy(usdcAddress)
    await feePool.deployed();
    feePoolAddress = feePool.address
    console.log(`feePoolAddress deployed to ${feePoolAddress}`)
    */
  } else if (network.name === 'rinkeby') {
    // rinkeby
    aggregatorAddress = '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e'
    wethAddress = '0xc778417e063141139fce010982780140aa0cd5ab'
    usdcAddress = '0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b'
  } else if (network.name === 'homestead') {
    aggregatorAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
    wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    feePoolAddress = '0x66fBaAd82083716343B9413CAeB77aA13a8053a4'
  }

  if (usdcAddress === undefined
    || wethAddress === undefined
    || aggregatorAddress === undefined
    || feePoolAddress === undefined
    || perpetualMarketAddress === undefined
    || perpetualMarketCoreAddress == undefined) {
    return
  }

  const ERC20 = await ethers.getContractFactory('ERC20')
  const usdc = await ERC20.attach(usdcAddress)
  const weth = await ERC20.attach(wethAddress)

  const PerpetualMarket = await ethers.getContractFactory('PerpetualMarket')
  const perpetualMarket = PerpetualMarket.attach(perpetualMarketAddress)

  const PerpetualMarketCore = await ethers.getContractFactory('PerpetualMarketCore')
  const perpetualMarketCore = PerpetualMarketCore.attach(perpetualMarketCoreAddress)

  const MockChainlinkAggregator = await ethers.getContractFactory('MockChainlinkAggregator')
  const mockChainlinkAggregator = MockChainlinkAggregator.attach(aggregatorAddress)

  const latest = await mockChainlinkAggregator.latestRoundData()

  console.log(latest)

  //const approveTx = await usdc.approve(perpetualMarket.address, '100000000000')
  //await approveTx.wait()

  //const approveTx2 = await weth.approve(perpetualMarket.address, '100000000000000000000')
  //await approveTx2.wait()


  //await perpetualMarket.initialize('10000000000', '500000')

  /*
  const tx1 = await perpetualMarket.openPositions({ vaultId: 0, subVaultIndex: 0, tradeAmounts: ['200000000', '-50000000'], collateralRatio: '80000000', limitPrices: [0, 0], deadline: 0 })
  await tx1.wait()
  await delay(15000)
  await check(1)

  const tx2 = await perpetualMarket.execHedge()
  await tx2.wait()
  await delay(15000)
  await check(2)

  const tx3 = await perpetualMarket.openPositions({ vaultId: 0, subVaultIndex: 0, tradeAmounts: ['-200000000', '50000000'], collateralRatio: '80000000', limitPrices: [0, 0], deadline: 0 })
  await tx3.wait()
  await delay(15000)
  await check(3)

  const tx4 = await perpetualMarket.execHedge()
  await tx4.wait()
  await delay(15000)
  await check(4)

  const tx5 = await perpetualMarket.openPositions({ vaultId: 0, subVaultIndex: 0, tradeAmounts: ['50000000', '50000000'], collateralRatio: '80000000', limitPrices: [0, 0], deadline: 0 })
  await tx5.wait()
  await delay(15000)
  await check(5)

  const tx6 = await perpetualMarket.openPositions({ vaultId: 0, subVaultIndex: 0, tradeAmounts: ['-50000000', '-50000000'], collateralRatio: '80000000', limitPrices: [0, 0], deadline: 0 })
  await tx6.wait()
  await delay(15000)
  await check(6)
  */

  async function check(index: number) {
    const usdcAmount = await usdc.balanceOf(perpetualMarket.address)
    console.log('usdcAmount', usdcAmount)

    const amountLiquidity = await perpetualMarketCore.amountLiquidity()

    console.log('amountLiquidity', amountLiquidity)

    console.log(index, 'sub', usdcAmount.mul(100).sub(amountLiquidity))
  }

  const pool0 = await perpetualMarketCore.pools(0)
  //console.log(0, pool0)
  const pool1 = await perpetualMarketCore.pools(1)
  //console.log(1, pool1)

  const tokenAmount = await perpetualMarket.balanceOf(signer.address)
  const withdrawAmount = await getWithdrawalAmount(tokenAmount, 0)
  console.log('withdrawAmount', withdrawAmount)
  // await perpetualMarket.withdraw(withdrawAmount.sub(1000))

  async function getWithdrawalAmount(burnAmount: BigNumber, _withdrawnAmount: BigNumberish): Promise<BigNumber> {
    const withdrawnAmount = BigNumber.from(_withdrawnAmount)

    const lpTokenPrice = await perpetualMarket.getLPTokenPrice(withdrawnAmount.mul(-1))
    console.log('lpTokenPrice', lpTokenPrice)

    const nextWithdrawnAmount = lpTokenPrice.mul(burnAmount).div('100000000')

    if (withdrawnAmount.eq(nextWithdrawnAmount)) {
      return withdrawnAmount
    }

    return getWithdrawalAmount(burnAmount, nextWithdrawnAmount)
  }
}


function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
