import { task, types } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import { getPerpetualMarketCore } from './utils'

// Example execution
/**
 * 550%
 * npx hardhat config --network rinkebyArbitrum --key squared --value0 550000000
 * 0.22%
 * npx hardhat config --network rinkebyArbitrum --key future --value0 220000
 * npx hardhat config --network rinkebyArbitrum --key hedge --value0 40 --value1 80 --value2 200000
 * npx hardhat config --network rinkebyArbitrum --key risk --value0 4000
 * npx hardhat config --network rinkebyArbitrum --key fee --value0 50000 --value1 10000
 */
task('config', 'set configs')
  .addParam('key', 'key', 'squared', types.string)
  .addParam('value0', 'value0', 0, types.int)
  .addParam('value1', 'value1', 0, types.int, true)
  .addParam('value2', 'value2', 0, types.int, true)
  .setAction(async ({ key, value0, value1, value2 }, hre) => {
    const { getNamedAccounts, ethers, network } = hre

    const { deployer } = await getNamedAccounts()

    const perpetualMarketCore = await getPerpetualMarketCore(ethers, deployer, network.name)

    if (key === 'squared') {
      await perpetualMarketCore.setSquaredPerpFundingMultiplier(value0)
    } else if (key === 'future') {
      await perpetualMarketCore.setPerpFutureMaxFundingRate(value0)
    } else if (key === 'hedge') {
      await perpetualMarketCore.setHedgeParams(value0, value1, value2)
    } else if (key === 'risk') {
      await perpetualMarketCore.setPoolMarginRiskParam(value0)
    } else if (key === 'fee') {
      await perpetualMarketCore.setTradeFeeRate(value0, value1)
    }
  })
