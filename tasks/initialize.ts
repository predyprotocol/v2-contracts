import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC, networkNameToPerpetualMarket } from "./utils";

// Example execution
/**
 * npx hardhat initialize --network rinkebyArbitrum --deposit-amount 1000000 --funding-rate 2
 */
task("initialize", "initialize liquidity")
  .addParam('depositAmount', 'deposit amount', '1000000', types.string)
  .addParam('fundingRate', 'funding rate', '500000', types.string)
  .setAction(async ({
    depositAmount,
    fundingRate
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const usdc = await getUSDC(ethers, deployer, network.name)
    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    await usdc.approve(perpetualMarket.address, depositAmount)
    await perpetualMarket.initialize(depositAmount, fundingRate)
  })
