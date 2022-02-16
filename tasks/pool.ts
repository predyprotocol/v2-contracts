import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC, toUnscaled } from "./utils";

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

    const lpTokenPrice = await perpetualMarket.getLPTokenPrice(0)
    const result = await perpetualMarket.getTokenAmountForHedging()

    console.log('LPToken Price : $', toUnscaled(lpTokenPrice.div('100000000'), 8).toLocaleString())
    console.log('Hedge         :')
    if (result[0]) {
      console.log(` Receive     : ${toUnscaled(result[1], 6).toLocaleString()} USDC`)
      console.log(` Required    : ${toUnscaled(result[2].div('10000000000'), 8).toLocaleString()} WETH`)
    } else {
      console.log(` Required    : ${toUnscaled(result[1], 6).toLocaleString()} USDC`)
      console.log(` Receive     : ${toUnscaled(result[2].div('10000000000'), 8).toLocaleString()} WETH`)
    }
  })
