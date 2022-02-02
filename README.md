# Predy v2 contracts

![](https://github.com/predyprotocol/v2-contracts/workflows/Test/badge.svg)
[![codecov](https://codecov.io/gh/predyprotocol/v2-contracts/branch/main/graph/badge.svg?token=yJ8DEr8Gck)](https://codecov.io/gh/predyprotocol/v2-contracts)


## Overview

Predy V2 is AMM(Automated Market Maker) for Perpetual Contracts.
It supports cross margin trading of Squared perpetual and Perpetual future.

### Contracts

`PerpetualMarket.sol` is entry point of traders and liquidity providers. It manages LP tokens and traders' vault storage.

`PerpetualMarketCore.sol` is the contract to manage perpetual pool state, such as pool positions and collaterals.

`FlashHedge.sol` is the contract to swap underlying assets and USDC tokens with Uniswap for delta hedging.

### Libraries

`lib/TraderVaultLib.sol` has functions to calculate position value and minimum collateral for implementing cross margin wallet.

`lib/NettingLib.sol` has functions to calculate pool's required collateral.

`lib/SpreadLib.sol` has functions to manage spread. It is to protect AMM from short-term volatility.

`lib/IndexPricer.sol` has functions to calculate index price, delta and gamma of Squared perpetual and Perpetual future.

`lib/EntryPriceMath.sol` has functions to calculate new entry price from previous entry price for implementing margin wallet.

`lib/Math.sol` has functions for basic mathematical calculations.

## Reference

TODO

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
