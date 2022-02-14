AMM
=====

AMM is the counter party of the traders.
It offers the trade price of Power Perpetuals and the price of LP(liquidity provider) token.
The implementation is `PerpetualMarketCore.sol`.

| Notation  | Variable Name | Description | 
| ------------- | ------------- | ------------- |
| L  | amountLiquidity  | total liquidity |
| M_i  | amountLockedLiquidity  | locked liquidity for perpetual contract i |
| ΔL  | deltaLiquidity | delta liquidity to provide or withdraw |
| ΔM_i  | deltaMargin | delta margin that pool lockes when opening or closing positions |
| Supply  |  supply | total supply of LP token |

`i` is index of subgroup {squared, future}.

## Trade Price

AMM determins funding rate of perpetuals to offer trade price.

Trade price is defined as:

`TradePrice_i = IndexPrice_i * (1 + FundingRate_i)`

The implementation function is:

```solidity
function calculateTradePrice(uint256 _productId, int256 _spotPrice, bool _isLong, int256 _deltaM, int256 _deltaLiquidity)
```

### Index Price

`IndexPrice_{squared} = S^2 / 10000`

`IndexPrice_{future} = S`

where S is underlying price from chainlink oracle.

### Funding Rate

Funding rate of Squared perpetual is defined as:

`FundingRate_{squared} = variance * (1 + squaredPerpFundingMultiplier * MarginDivLiquidity_{squared})`

Funding rate of Perpetual future is defined as:

`FundingRate_{future} = BASE_FUNDING_RATE + perpFutureMaxFundingRate * MarginDivLiquidity_{future}`

The formula of MarginDivLiquidity is

`MarginDivLiquidity_i = ((M_i + ΔM_i / 2) / ΔL) * (log(L + ΔL) - log(_L))`.

The implementation function is:

```solidity
function calculateMarginDivLiquidity(int256 _m,int256 _deltaM,int256 _l,int256 _deltaL)
```

## Variance

Variance of underlying asset is calculated by Exponentially Weighted Moving Average Model.

The formula is:

`variance_{t} = λ * variance_{t-1} + (1 - λ) * u_{t-1}^2`

`u_{t-1} = (S_t - S_{t-1}) / S_{t-1}`

λ is 0.94.

`variance_t` is variance estimation of underlying asset at time `t`.

`u_t` is return rate of underlying asset at time `t`.

The initial variance is setted by the first LP calling `initialize` function.

The implementation function is:

```solidity
function updateVariance()
```

## LP Token Price

LP token price is defined as:

`LPTokenPrice = (L + ΣUnrealizedPnL_i - ΣM_i) / Supply`

The implementation function is:

```solidity
function getLPTokenPrice(int256 _deltaLiquidityAmount)
```

`UnrealizedPnL_i = (TradePrice_i - EntryPrice_i) * Position_i + HedgePositionValue_i`

This trade price is the price to close all pool positions.
And `_deltaLiquidity` is positive when LPs deposit and negative when LPs withdraw.

### Deposit and withdraw liquidity

AMM calculates how many share tokens to mint when LPs provide liquidity and how many quote asset to return when Lps withdraw liquidity.
The principle is to keep the price of LPToken unchanged after adding and removing liquidity.

AMM will calculate how much share token to mint when LP adds liquidity.

`LPTokenToMint = depositAmouint / LPTokenPrice`

AMM will calculate how much share token to burn when LP removes liquidity.

`LPTokenToBurn = withdrawnAmount / LPTokenPrice`
