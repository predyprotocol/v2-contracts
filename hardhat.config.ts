import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-deploy";
import "@eth-optimism/hardhat-ovm";

dotenv.config();

const InfuraKey = process.env.INFURA_API_KEY

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  networks: {
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${InfuraKey}`,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${InfuraKey}`,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${InfuraKey}`,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      gas: 8000000
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${InfuraKey}`,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    xdai: {
      url: "https://rpc.xdaichain.com/",
      gasPrice: 1000000000,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    matic: {
      url: "https://rpc-mainnet.maticvigil.com/",
      gasPrice: 1000000000,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    rinkebyArbitrum: {
      url: "https://rinkeby.arbitrum.io/rpc",
      gasPrice: 30000000, // 0.03 gwei
      gas: 30_000_000,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      companionNetworks: {
        l1: "rinkeby",
      },
    },
    kovanOptimism: {
      url: `https://optimism-kovan.infura.io/v3/${InfuraKey}`,
      gasPrice: 0,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      ovm: true,
      companionNetworks: {
        l1: "kovan",
      },
    },
    optimism: {
      url: `https://optimism-mainnet.infura.io/v3/${InfuraKey}`,
      gasPrice: 0,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      ovm: true,
      companionNetworks: {
        l1: "mainnet",
      },
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ]
  },
  ovm: {
    solcVersion: "0.7.6",
  },
  gasReporter: {
    enabled: true,
    showTimeSpent: true,
    currency: 'USD',
    gasPrice: 50
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
