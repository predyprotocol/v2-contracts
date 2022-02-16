import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket } from "./utils";

// Example execution
/**
 * npx hardhat liquidate --network rinkebyArbitrum --vault-owner '0x0000000000000000000000000000000000000000' --vault-id 0
 */
task("liquidate", "liquidate a vault")
  .addParam('vaultOwner', 'vault id', '0', types.string)
  .addParam('vaultId', 'vault id', '0', types.string)
  .setAction(async ({
    vaultOwner,
    vaultId
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    console.log('Start to liquidate')
    const tx = await perpetualMarket.liquidateByPool(vaultOwner, vaultId)
    await tx.wait()
    console.log('Suceed to liquidate')
  })
