import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC } from "./utils";
import { BigNumber } from "ethers";

// Example execution
/**
 * npx hardhat trade --network rinkebyArbitrum --trade-amount0 1000000 --margin-amount 1000000
 */
task("trade", "trade perpetuals")
  .addParam('vaultId', 'vault id', '0', types.string)
  .addParam('subVaultIndex', 'sub-vault index', '0', types.string)
  .addParam('tradeAmount0', 'sqeeth trade amount', '0', types.string)
  .addParam('tradeAmount1', 'future trade amount', '0', types.string)
  .addParam('marginAmount', 'margin amount', '0', types.string)
  .setAction(async ({
    vaultId,
    subVaultIndex,
    tradeAmount0,
    tradeAmount1,
    marginAmount
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const usdc = await getUSDC(ethers, deployer, network.name)
    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    if (BigNumber.from(marginAmount).gt(0)) {
      const approveTx = await usdc.approve(perpetualMarket.address, marginAmount)
      await approveTx.wait()
    }

    console.log('Start to trade')
    const tx = await perpetualMarket.trade({ vaultId, subVaultIndex, tradeAmounts: [tradeAmount0, tradeAmount1], marginAmount, limitPrices: [0, 0], deadline: 0 })
    await tx.wait()
    console.log('Suceed to trade')
  })
