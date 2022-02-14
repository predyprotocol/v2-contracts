TraderVault
=====

Predy's trader vault offers cross margin trading of Squared perpetual and Perpetual future.
The implementation is `lib/TraderVaultLib.sol`.

| Notation  | Variable Name | Description | 
| ------------- | ------------- | ------------- |
| S | spotPrice | spot price |
| TradePrice_i | tradePrice | trade price of product `i` |
| PositionUSDC | positionUsdc | the amount of USDC that the vault hold |
| FundingFeeGlobal_i | amountsFundingPaidPerPosition | funding fee per position of product `i` |
| PositionPerpetual_{i,j}  | positionPerpetuals  | position perpetuals of product `i` in sub-vault `j` |
| EntryPrices_{i,j}  | entryPrices  | entry price of product `i` in sub-vault `j` |
| EntryFundingFee_{i,j}  | entryFundingFee  | entry funding fee of product `i` in sub-vault `j` |

`i` is index of subgroup {squared, future}.

### TraderVault

Trader can keep position open as long as PositionValue is greater than MinCollateral.

PositionValue is defined as follow:

`PositionValue = ΣΣ(PerpetualValue_{i,j} + FundingFeePaid_{i,j})`

`PerpetualValue_{i,j} = (TradePrice_i - EntryPrice_{i,j}) * PositionPerpetual_{i,j}`

`FundingFeePaid_{i,j} = (EntryFundingFee_{i,j} - FundingFeeGlobal_i) * PositionPerpetual_{i,j}`

MinCollateral is defined as follow:

`MinCollateral = 0.075 * S * (|2*S*PositionSquared+PositionFuture| + 0.15*S*|PositionSquared|)`

where `PositionSquared = ΣPositionPerpetual_{0,j}` and `PositionFuture = ΣPositionPerpetual_{1,j}`.

### Liquidation

Anyone can liquidate a vault whose PositionValue is less than MinCollateral.

The procedure if liquidation is follow:

1. Checks the PositionValue is less than MinCollateral.
2. Closes all positions in the vault by trading on AMM.
3. Calculates reward for the liquidator and AMM.

The liquidator can get the portion of margin as the reward.
The formula is defined as:

`Reward = min(0.2 * MinCollateral, PositionUSDC)`

MinCollateral is calculated before step 2. and PositionUSDC is calculated after step 2.

The liquidator will get a half of `Reward`, AMM will get the other half.
