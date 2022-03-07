import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import { getFlashHedge } from './utils'

// Example execution
/**
 * npx hardhat hedge --network rinkebyArbitrum
 */
task('hedge', 'execute a hedge').setAction(async ({}, hre) => {
  const { getNamedAccounts, ethers, network } = hre

  const { deployer } = await getNamedAccounts()

  const flashHedge = await getFlashHedge(ethers, deployer, network.name)

  console.log('Start a hedge')
  const tx = await flashHedge.hedgeOnUniswap(0)
  await tx.wait()
  console.log('Succeed to hedge')
})
