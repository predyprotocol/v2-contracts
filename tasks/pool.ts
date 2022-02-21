import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getPerpetualMarketCore, toUnscaled } from "./utils";

// Example execution
/**
 * npx hardhat pool --network rinkebyArbitrum
 */
task("pool", "get pool status")
  .addParam('vaultId', 'vault id', '0', types.string)
  .setAction(async ({
    vaultId
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)
    const perpetualMarketCore = await getPerpetualMarketCore(ethers, deployer, network.name)

    const lpTokenPrice = await perpetualMarket.getLPTokenPrice(0)
    const result = await perpetualMarket.getTokenAmountForHedging()
    const utilizationRatio = await perpetualMarketCore.getUtilizationRatio()
    const amountLiquidity = await perpetualMarketCore.amountLiquidity()
    const pool0 = await perpetualMarketCore.pools(0)
    const pool1 = await perpetualMarketCore.pools(1)

    console.log('LPToken Price : $', toUnscaled(lpTokenPrice.div('100000000'), 8).toLocaleString())
    console.log(`Liquidity Amount  : $${toUnscaled(amountLiquidity, 8).toLocaleString()}`)
    console.log(`Utilization Ratio : ${toUnscaled(utilizationRatio, 6).toLocaleString()}%`)
    console.log('Future Pool')
    console.log(` position         : ${toUnscaled(pool0.positionPerpetuals, 8).toLocaleString()} ETH`)
    console.log(` locked liquidity : ${toUnscaled(pool0.amountLockedLiquidity, 8).toLocaleString()} USDC`)
    console.log('Squared Pool')
    console.log(` position         : ${toUnscaled(pool1.positionPerpetuals, 8).toLocaleString()} SQUEETH`)
    console.log(` locked liquidity : ${toUnscaled(pool1.amountLockedLiquidity, 8).toLocaleString()} USDC`)
    console.log('Hedge         :')
    if (result[0]) {
      console.log(` Receive     : ${toUnscaled(result[1], 6).toLocaleString()} USDC`)
      console.log(` Required    : ${toUnscaled(result[2].div('10000000000'), 8).toLocaleString()} WETH`)
    } else {
      console.log(` Required    : ${toUnscaled(result[1], 6).toLocaleString()} USDC`)
      console.log(` Receive     : ${toUnscaled(result[2].div('10000000000'), 8).toLocaleString()} WETH`)
    }
  })
