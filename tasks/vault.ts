import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC, toUnscaled } from "./utils";

// Example execution
/**
 * npx hardhat vault --network rinkebyArbitrum
 */
task("vault", "get vault status")
  .addParam('vaultId', 'vault id', '0', types.string)
  .setAction(async ({
    vaultId
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    const vaultStatus = await perpetualMarket.getVaultStatus(deployer, vaultId)

    console.log('USDC           : $', toUnscaled(vaultStatus.rawVaultData.positionUsdc, 8).toLocaleString())
    console.log('Value          : $', toUnscaled(vaultStatus.positionValue, 8).toLocaleString())
    console.log('MinCollateral  : $', toUnscaled(vaultStatus.minCollateral, 8).toLocaleString())

    for (let i = 0; i < vaultStatus.positionValues.length; i++) {
      console.log('PositionValues')
      console.log(` SubVault: ${i}`)
      console.log('  Sqeeth : $', toUnscaled(vaultStatus.positionValues[i][0], 8).toLocaleString())
      console.log('  Future : $', toUnscaled(vaultStatus.positionValues[i][1], 8).toLocaleString())
    }

    for (let i = 0; i < vaultStatus.fundingPaid.length; i++) {
      console.log('FundingPaid')
      console.log(` SubVault: ${i}`)
      console.log('  Sqeeth : $', toUnscaled(vaultStatus.fundingPaid[i][0], 8).toLocaleString())
      console.log('  Future : $', toUnscaled(vaultStatus.fundingPaid[i][1], 8).toLocaleString())
    }

    for (let i = 0; i < vaultStatus.rawVaultData.subVaults.length; i++) {
      console.log('Positions')
      console.log(` SubVault: ${i}`)
      console.log('  Sqeeth :  ', toUnscaled(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[0], 8).toLocaleString())
      console.log('  Future :  ', toUnscaled(vaultStatus.rawVaultData.subVaults[0].positionPerpetuals[1], 8).toLocaleString())
    }
  })
