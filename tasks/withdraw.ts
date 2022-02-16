import { task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { getPerpetualMarketCore, getPerpetualMarket, getUSDC } from "./utils";
import { BigNumber, BigNumberish } from "ethers";

// Example execution
/**
 * npx hardhat withdraw --network rinkebyArbitrum --withdraw-amount 1000000
 */
task("withdraw", "withdraw liquidity")
  .addParam('withdrawAmount', 'withdraw amount', '0', types.string)
  .setAction(async ({
    withdrawAmount
  }, hre) => {

    const { getNamedAccounts, ethers, network } = hre;

    const { deployer } = await getNamedAccounts();

    const usdc = await getUSDC(ethers, deployer, network.name)
    const perpetualMarket = await getPerpetualMarket(ethers, deployer, network.name)
    const lpToken = await getPerpetualMarketCore(ethers, deployer, network.name)

    const tokenAmount = await lpToken.balanceOf(deployer)
    await perpetualMarket.withdraw(BigNumber.from(withdrawAmount).eq(0) ? await getWithdrawalAmount(tokenAmount, 0) : withdrawAmount)

    async function getWithdrawalAmount(burnAmount: BigNumber, _withdrawnAmount: BigNumberish): Promise<BigNumber> {
      const withdrawnAmount = BigNumber.from(_withdrawnAmount)

      const lpTokenPrice = await perpetualMarket.getLPTokenPrice(withdrawnAmount.mul(-1))
      console.log('lpTokenPrice', lpTokenPrice)

      const nextWithdrawnAmount = lpTokenPrice.mul(burnAmount).div('10000000000000000')

      if (withdrawnAmount.eq(nextWithdrawnAmount)) {
        return withdrawnAmount
      }

      return getWithdrawalAmount(burnAmount, nextWithdrawnAmount)
    }
  })
