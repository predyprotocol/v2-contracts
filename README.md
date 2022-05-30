# Predy v2 contracts

![](https://github.com/predyprotocol/v2-contracts/workflows/Test/badge.svg)
[![codecov](https://codecov.io/gh/predyprotocol/v2-contracts/branch/main/graph/badge.svg?token=yJ8DEr8Gck)](https://codecov.io/gh/predyprotocol/v2-contracts)


## Overview

Predy V2 is AMM(Automated Market Maker) for Perpetual Contracts.
It supports portfolio margin trading of Squared perpetual and Perpetual future.
Portfolio Margin is a margin method that utilizes the unrealized profits of other positions in the relevant asset to avoid liquidations on the positions using the same settlement asset.
As a result, Predy's margin requirements for perpetual positions are significantly reduced compared to traditional policy rules.

### Contracts

`PerpetualMarket.sol` is entry point of traders and liquidity providers. It manages traders' vault storage and holds funds from traders and liquidity providers.

`PerpetualMarketCore.sol` is the contract to manage perpetual pool positions and calculate amount of collaterals. It inherits ERC20 Token representing liquidity provider token.

`FlashHedge.sol` is the contract helps to swap underlying assets and USDC tokens with Uniswap for delta hedging.

### Libraries

`lib/TraderVaultLib.sol` has functions to calculate position value and minimum collateral for implementing margin wallet.

`lib/NettingLib.sol` has functions to calculate pool's required collateral.

`lib/SpreadLib.sol` has functions to manage spread. It is to protect AMM from short-term volatility.

`lib/IndexPricer.sol` has functions to calculate index price, delta and gamma of Squared perpetual and Perpetual future.

`lib/EntryPriceMath.sol` has functions to calculate new entry price and profit from previous entry price and trade price for implementing margin wallet.

`lib/Math.sol` has functions for basic mathematical calculation.

## Reference

### Docs

* [AMM](./docs/amm.md)
* [TraderVault](./docs/trader-vault.md)

### Audit

- [Audit1: Zokyo Audit Report](./docs/audit-zokyo-predy.pdf)

## Development

Run all tests

```shell
npm test
```

Check contract size

```shell
npx hardhat size-contracts
```

### Deploy

To deploy contract on testnet or mainnet, you'll need to provide an infura key to connect to an infura node.
Copy .env.example file as .env and specify your keys there.

```shell
npx hardhat run --network rinkebyArbitrum ./scripts/deploy.ts
```

### Call Contracts

Gets vault status.

```shell
npx hardhat vault --network rinkebyArbitrum
```

## Using foundry

```shell
./bin/setup.sh
```
```shell
forge build --hardhat
```

### Testing

```shell
forge test
```

forge install openzeppelin/openzeppelin-contracts@v3.4.2-solc-0.7
forge install uniswap/v3-core@1.0.0
forge install uniswap/v3-periphery
forge install smartcontractkit/chainlink