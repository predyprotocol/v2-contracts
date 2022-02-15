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

    console.log('LPToken Price : $', toUnscaled(lpTokenPrice.div('100000000'), 8).toLocaleString())
  })
