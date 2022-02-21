import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getPriceFeed, toUnscaled } from "./utils";
import { BigNumber } from "ethers";

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
    const priceFeed = await getPriceFeed(ethers, deployer, network.name)

    const roundData = await priceFeed.latestRoundData()

    const vaultStatus = await perpetualMarket.getVaultStatus(vaultId)

    console.log('USDC           : $', toUnscaled(vaultStatus.rawVaultData.positionUsdc, 8).toLocaleString())
    console.log('Value          : $', toUnscaled(vaultStatus.positionValue, 8).toLocaleString())
    console.log('MinCollateral  : $', toUnscaled(vaultStatus.minCollateral, 8).toLocaleString())

    const liquidationPrices = getVaultLiquidationPrice(vaultStatus)

    console.log('Underlying Price  : $', toUnscaled(roundData.answer, 8).toLocaleString())

    if (liquidationPrices.length == 0) {
      console.log('LiquidationPrice  : no liquidation price')
    } else if (liquidationPrices.length == 1) {
      console.log('LiquidationPrice  : $', liquidationPrices[0].toLocaleString())
    } else if (liquidationPrices.length == 2) {
      console.log('LiquidationPrice  : $', liquidationPrices[0].toLocaleString(), liquidationPrices[1].toLocaleString())
    }

    console.log('PositionValues')
    for (let i = 0; i < vaultStatus.positionValues.length; i++) {
      console.log(` SubVault: ${i}`)
      console.log('  Future : $', toUnscaled(vaultStatus.positionValues[i][0], 8).toLocaleString())
      console.log('  Squared : $', toUnscaled(vaultStatus.positionValues[i][1], 8).toLocaleString())
    }

    console.log('FundingPaid')
    for (let i = 0; i < vaultStatus.fundingPaid.length; i++) {
      console.log(` SubVault: ${i}`)
      console.log('  Future : $', toUnscaled(vaultStatus.fundingPaid[i][0], 8).toLocaleString())
      console.log('  Squared : $', toUnscaled(vaultStatus.fundingPaid[i][1], 8).toLocaleString())
    }

    console.log('Positions')
    for (let i = 0; i < vaultStatus.rawVaultData.subVaults.length; i++) {
      const future = vaultStatus.rawVaultData.subVaults[i].positionPerpetuals[0]
      const squared = vaultStatus.rawVaultData.subVaults[i].positionPerpetuals[1]
      const delta = squared.mul(2).mul(roundData.answer).div('1000000000000').add(future)

      console.log(` SubVault: ${i}`)
      console.log('  Future :  ', toUnscaled(future, 8).toLocaleString())
      console.log('  Squared :  ', toUnscaled(squared, 8).toLocaleString())
      console.log('  Delta   :  ', toUnscaled(delta, 8).toLocaleString())
    }
  })

function getVaultLiquidationPrice(vaultStatus: any) {
  const rawVaultData = vaultStatus.rawVaultData
  const a0 = rawVaultData.subVaults.reduce((acc: BigNumber, subVault: any) => acc.add(subVault.positionPerpetuals[0]), BigNumber.from(0))
  const a1 = rawVaultData.subVaults.reduce((acc: BigNumber, subVault: any) => acc.add(subVault.positionPerpetuals[1]), BigNumber.from(0))
  const e0 = rawVaultData.subVaults.reduce((acc: BigNumber, subVault: any) => acc.add(subVault.positionPerpetuals[0].mul(subVault.entryPrices[0])), BigNumber.from(0))
  const e1 = rawVaultData.subVaults.reduce((acc: BigNumber, subVault: any) => acc.add(subVault.positionPerpetuals[1].mul(subVault.entryPrices[1])), BigNumber.from(0))
  const fundingPaid = vaultStatus.fundingPaid.reduce((acc: BigNumber, fundingPaid: any) => acc.add(fundingPaid[0].add(fundingPaid[1])), BigNumber.from(0))

  return getLiquidationPrice(
    toUnscaled(a0, 8),
    toUnscaled(a1, 8),
    a0.eq(0) ? 0 : toUnscaled(e0.div(a0), 8),
    a1.eq(0) ? 0 : toUnscaled(e1.div(a1), 8),
    toUnscaled(rawVaultData.positionUsdc.add(fundingPaid), 8)
  )
}

function getLiquidationPrice(a0: number, a1: number, e0: number, e1: number, v: number) {
  const alpha = 0.075
  const r1 = solveQuadraticFormula(
    (2 * alpha * (1 + alpha) - 1) * a1 / 10000,
    a0 * (alpha - 1),
    a0 * e0 + a1 * e1 - v
  )
  const r2 = solveQuadraticFormula(
    (2 * alpha * (alpha - 1) - 1) * a1 / 10000,
    - a0 * (alpha + 1),
    a0 * e0 + a1 * e1 - v
  )
  const r3 = solveQuadraticFormula(
    (2 * alpha * (1 - alpha) - 1) * a1 / 10000,
    a0 * (alpha - 1),
    a0 * e0 + a1 * e1 - v
  )
  const r4 = solveQuadraticFormula(
    (2 * alpha * (- alpha - 1) - 1) * a1 / 10000,
    - a0 * (alpha + 1),
    a0 * e0 + a1 * e1 - v
  )

  const results: number[] = []

  if (a1 >= 0) {
    r1.forEach(r => {
      if (2 * r * a1 >= -a0 * 10000) {
        results.push(r)
      }
    })
    r2.forEach(r => {
      if (2 * r * a1 < -a0 * 10000) {
        results.push(r)
      }
    })
  } else {
    r3.forEach(r => {
      if (2 * r * a1 >= -a0 * 10000) {
        results.push(r)
      }
    })
    r4.forEach(r => {
      if (2 * r * a1 < -a0 * 10000) {
        results.push(r)
      }
    })
  }

  return results.filter(r => r >= 0)
}

function solveQuadraticFormula(a: number, b: number, c: number) {
  if (a === 0) {
    return [-c / b]
  }

  const e = Math.sqrt(b ** 2 - 4 * a * c)
  return [
    (-b + e) / (2 * a),
    (-b - e) / (2 * a)
  ]
}
