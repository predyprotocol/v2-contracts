import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, toUnscaled } from "./utils";

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

    console.log('PositionValues')
    for (let i = 0; i < vaultStatus.positionValues.length; i++) {
      console.log(` SubVault: ${i}`)
      console.log('  Future : $', toUnscaled(vaultStatus.positionValues[i][0], 8).toLocaleString())
      console.log('  Sqeeth : $', toUnscaled(vaultStatus.positionValues[i][1], 8).toLocaleString())
    }

    console.log('FundingPaid')
    for (let i = 0; i < vaultStatus.fundingPaid.length; i++) {
      console.log(` SubVault: ${i}`)
      console.log('  Future : $', toUnscaled(vaultStatus.fundingPaid[i][0], 8).toLocaleString())
      console.log('  Sqeeth : $', toUnscaled(vaultStatus.fundingPaid[i][1], 8).toLocaleString())
    }

    console.log('Positions')
    for (let i = 0; i < vaultStatus.rawVaultData.subVaults.length; i++) {
      console.log(` SubVault: ${i}`)
      console.log('  Future :  ', toUnscaled(vaultStatus.rawVaultData.subVaults[i].positionPerpetuals[0], 8).toLocaleString())
      console.log('  Sqeeth :  ', toUnscaled(vaultStatus.rawVaultData.subVaults[i].positionPerpetuals[1], 8).toLocaleString())
    }
  })

/*
function getLiquidationPrice(a: number, b: number, v: number) {
const alpha = 0.075
if (a > 0) {
  const r1 = (alpha * b + Math.sqrt((alpha * b) ** 2 + 8 * alpha * a * (1 + alpha) * v)) / (4 * alpha * a * (1 + alpha))
  const r2 = (alpha * b + Math.sqrt((alpha * b) ** 2 + 8 * alpha * a * (1 - alpha) * v)) / (4 * alpha * a * (1 - alpha))
  if (2 * r1 * a > -b) {
    return r1
  } else {
    return r2
  }
} else {
  const r1 = (alpha * b + Math.sqrt((alpha * b) ** 2 - 8 * alpha * a * (1 + alpha) * v)) / (4 * alpha * a * (1 + alpha))
  const r2 = (alpha * b + Math.sqrt((alpha * b) ** 2 - 8 * alpha * a * (1 - alpha) * v)) / (4 * alpha * a * (1 - alpha))
  if (2 * r1 * a > -b) {
    return r1
  } else {
    return r2
  }
}
}
*/