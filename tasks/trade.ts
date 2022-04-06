import { task, types } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import { getPerpetualMarket, getUSDC } from './utils'
import { BigNumber } from 'ethers'
import { FUTURE_PRODUCT_ID, SQUEETH_PRODUCT_ID } from '../test/utils/constants'

// Example execution
/**
 * npx hardhat trade --network rinkebyArbitrum --trade-amount0 1000000 --margin-amount 1000000
 */
task('trade', 'trade perpetuals')
  .addParam('vaultId', 'vault id', '0', types.string)
  .addParam('subVaultIndex', 'sub-vault index', '0', types.string)
  .addParam('tradeAmount0', 'sqeeth trade amount', '0', types.string)
  .addParam('tradeAmount1', 'future trade amount', '0', types.string)
  .addParam('marginAmount', 'margin amount', '0', types.string)
  .setAction(async ({ vaultId, subVaultIndex, tradeAmount0, tradeAmount1, marginAmount }, hre) => {
    const { getNamedAccounts, ethers, network } = hre

    const { deployer } = await getNamedAccounts()

    const usdc = await getUSDC(ethers, deployer, network.name)
    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    if (BigNumber.from(marginAmount).gt(0)) {
      const approveTx = await usdc.approve(perpetualMarket.address, marginAmount)
      await approveTx.wait()
    }

    console.log('Start to trade')
    const tradeParams = []
    if (!BigNumber.from(tradeAmount0).eq(0)) {
      tradeParams.push({
        productId: FUTURE_PRODUCT_ID,
        subVaultIndex,
        tradeAmount: tradeAmount0,
        limitPrice: 0,
        metadata: '0x',
      })
    }
    if (!BigNumber.from(tradeAmount1).eq(0)) {
      tradeParams.push({
        productId: SQUEETH_PRODUCT_ID,
        subVaultIndex,
        tradeAmount: tradeAmount1,
        limitPrice: 0,
        metadata: '0x',
      })
    }
    const tx = await perpetualMarket.trade({
      vaultId,
      trades: tradeParams,
      marginAmount,
      deadline: 0,
    })
    await tx.wait()
    console.log('Succeed to trade')
  })
