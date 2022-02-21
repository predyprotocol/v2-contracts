import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket } from "./utils";

// Example execution
/**
 * npx hardhat liquidate --network rinkebyArbitrum --vault-id 0
 */
task("liquidate", "liquidate a vault")
  .addParam('vaultId', 'vault id', '0', types.string)
  .setAction(async ({
    vaultId
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    console.log('Start to liquidate')
    const tx = await perpetualMarket.liquidateByPool(vaultId)
    await tx.wait()
    console.log('Suceed to liquidate')
  })
