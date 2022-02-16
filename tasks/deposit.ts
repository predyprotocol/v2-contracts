import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC } from "./utils";

// Example execution
/**
 * npx hardhat deposit --network rinkebyArbitrum --deposit-amount 1000000
 */
task("deposit", "deposit liquidity")
  .addParam('depositAmount', 'deposit amount', '0', types.string)
  .setAction(async ({
    depositAmount
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const usdc = await getUSDC(ethers, deployer, network.name)
    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    await usdc.approve(perpetualMarket.address, depositAmount)
    await perpetualMarket.deposit(depositAmount)
  })
