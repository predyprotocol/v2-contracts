import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import {
  getFlashHedge,
  getPerpetualMarket,
  getPerpetualMarketCore,
  getVaultNFT,
  networkNameToFeePool,
  networkNameToOperator,
} from './utils'

// Example execution
/**
 * npx hardhat check --network rinkebyArbitrum
 */
task('check', 'check contracts').setAction(async ({}, hre) => {
  const { getNamedAccounts, ethers, network } = hre

  const { deployer } = await getNamedAccounts()

  const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)
  const perpetualMarketCore = await getPerpetualMarketCore(ethers, deployer, network.name)
  const vaultNFT = await getVaultNFT(ethers, deployer, network.name)
  const flashHedge = await getFlashHedge(ethers, deployer, network.name)
  const operator = networkNameToOperator(network.name)
  const feePool = networkNameToFeePool(network.name)

  const feeRecepient = await perpetualMarket.feeRecepient()
  const owner = await perpetualMarket.owner()
  const quoteAsset = await perpetualMarket.quoteAsset()
  const underlyingAsset = await perpetualMarket.underlyingAsset()

  const ownerOfCore = await perpetualMarketCore.owner()

  const perpetualMarketOfVaultNFT = await vaultNFT.perpetualMarket()

  const collateral = await flashHedge.collateral()
  const underlying = await flashHedge.underlying()

  if (!(feePool === feeRecepient)) {
    console.error('fee recepient is invalid')
  }

  if (!(perpetualMarket.address === perpetualMarketOfVaultNFT)) {
    console.error('perpetual market address is invalid')
  }

  if (!(owner === operator && ownerOfCore === operator)) {
    console.error('operator address is invalid')
  }

  if (!(quoteAsset === collateral && underlyingAsset === underlying)) {
    console.error('token address is invalid')
  }

  console.log('ok')
})
