# Predy v2 contracts

![](https://github.com/predyprotocol/v2-contracts/workflows/Test/badge.svg)
[![codecov](https://codecov.io/gh/predyprotocol/v2-contracts/branch/main/graph/badge.svg?token=yJ8DEr8Gck)](https://codecov.io/gh/predyprotocol/v2-contracts)


## Overview

Predy V2 is AMM(Automated Market Maker) for Perpetual Contracts.
It supports cross margin trading of Squared perpetual and Perpetual future.

### Contracts

`PerpetualMarket.sol` is entry point of traders and liquidity providers. It manages traders' vault storage and holds funds from traders and liquidity providers.

`PerpetualMarketCore.sol` is the contract to manage perpetual pool positions and calculate amount of collaterals.

`FlashHedge.sol` is the contract helps to swap underlying assets and USDC tokens with Uniswap for delta hedging.

`LPToken.sol` is ERC20 Token representing liquidity provider token.

### Libraries

`lib/TraderVaultLib.sol` has functions to calculate position value and minimum collateral for implementing cross margin wallet.

`lib/NettingLib.sol` has functions to calculate pool's required collateral.

`lib/SpreadLib.sol` has functions to manage spread. It is to protect AMM from short-term volatility.

`lib/IndexPricer.sol` has functions to calculate index price, delta and gamma of Squared perpetual and Perpetual future.

`lib/EntryPriceMath.sol` has functions to calculate new entry price and profit from previous entry price and trade price for implementing margin wallet.

`lib/Math.sol` has functions for basic mathematical calculation.

## Reference

TODO

### Docs

* [AMM](./docs/amm.md)
* [TraderVault](./docs/trader-vault.md)

## Audit

TODO

## Development

Run all tests

```shell
npm test
```

Check contract size

```shell
npx hardhat size-contracts
```
