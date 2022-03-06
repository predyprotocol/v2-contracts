import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import { getPerpetualMarket, getUSDC, getWETH } from './utils'

// Example execution
/**
 * npx hardhat raw-hedge --network rinkebyArbitrum
 */
task('raw-hedge', 'execute a hedge').setAction(async ({}, hre) => {
  const { getNamedAccounts, ethers, network } = hre

  const { deployer } = await getNamedAccounts()

  const usdc = await getUSDC(ethers, deployer, network.name)
  const weth = await getWETH(ethers, deployer, network.name)
  const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

  const result = await perpetualMarket.getTokenAmountForHedging()

  let approveTx
  if (result[0]) {
    approveTx = await weth.approve(perpetualMarket.address, result[2].mul(105).div(100))
  } else {
    approveTx = await usdc.approve(perpetualMarket.address, result[1].mul(105).div(100))
  }
  await approveTx.wait()

  console.log('Start a hedge')
  const tx = await perpetualMarket.execHedge()
  await tx.wait()
  console.log('Suceed to hedge')
})
