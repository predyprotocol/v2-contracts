import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarket, getUSDC, toUnscaled } from "./utils";

// Example execution
/**
 * npx hardhat price --network rinkebyArbitrum --trade-amount 100000000
 */
task("price", "get trade price")
  .addParam('productId', 'product id', '0', types.string)
  .addParam('tradeAmount', 'trade amount', '100000000', types.string)
  .setAction(async ({
    productId,
    tradeAmount
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)

    const sqeethTradePrice = await perpetualMarket.getTradePrice(0, tradeAmount)
    const futureTradePrice = await perpetualMarket.getTradePrice(1, tradeAmount)

    console.log('Sqeeth')
    console.log(' TradePrice  : $', toUnscaled(sqeethTradePrice[0], 8).toLocaleString())
    console.log(' IndexPrice  : $', toUnscaled(sqeethTradePrice[1], 8).toLocaleString())
    console.log(' FundingRate  : $', toUnscaled(sqeethTradePrice[2], 8).toLocaleString())
    console.log(' TradeFee  : $', toUnscaled(sqeethTradePrice[3], 8).toLocaleString())
    console.log(' ProtocolFee  : $', toUnscaled(sqeethTradePrice[4], 8).toLocaleString())
    console.log(' FundingFee  : $', toUnscaled(sqeethTradePrice[5], 8).toLocaleString())
    console.log(' TotalValue  : $', toUnscaled(sqeethTradePrice[6], 8).toLocaleString())
    console.log(' TotalFee  : $', toUnscaled(sqeethTradePrice[7], 8).toLocaleString())
    console.log('Future')
    console.log(' TradePrice  : $', toUnscaled(futureTradePrice[0], 8).toLocaleString())
    console.log(' IndexPrice  : $', toUnscaled(futureTradePrice[1], 8).toLocaleString())
    console.log(' FundingRate  : $', toUnscaled(futureTradePrice[2], 8).toLocaleString())
    console.log(' TradeFee  : $', toUnscaled(futureTradePrice[3], 8).toLocaleString())
    console.log(' ProtocolFee  : $', toUnscaled(futureTradePrice[4], 8).toLocaleString())
    console.log(' FundingFee  : $', toUnscaled(futureTradePrice[5], 8).toLocaleString())
    console.log(' TotalValue  : $', toUnscaled(futureTradePrice[6], 8).toLocaleString())
    console.log(' TotalFee  : $', toUnscaled(futureTradePrice[7], 8).toLocaleString())
  })
