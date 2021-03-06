import * as dotenv from 'dotenv'
import fs from 'fs'

import { HardhatUserConfig, task } from 'hardhat/config'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import '@eth-optimism/hardhat-ovm'
// eslint-disable-next-line node/no-missing-import
import './tasks/initialize'
// eslint-disable-next-line node/no-missing-import
import './tasks/deposit'
// eslint-disable-next-line node/no-missing-import
import './tasks/withdraw'
// eslint-disable-next-line node/no-missing-import
import './tasks/trade'
// eslint-disable-next-line node/no-missing-import
import './tasks/liquidate'
// eslint-disable-next-line node/no-missing-import
import './tasks/hedge'
// eslint-disable-next-line node/no-missing-import
import './tasks/raw-hedge'
// eslint-disable-next-line node/no-missing-import
import './tasks/vault'
// eslint-disable-next-line node/no-missing-import
import './tasks/price'
// eslint-disable-next-line node/no-missing-import
import './tasks/pool'
// eslint-disable-next-line node/no-missing-import
import './tasks/check'
// eslint-disable-next-line node/no-missing-import
import './tasks/config'
import 'hardhat-preprocessor'

dotenv.config()

const InfuraKey = process.env.INFURA_API_KEY

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: 'http://localhost:8545',
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${InfuraKey}`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${InfuraKey}`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${InfuraKey}`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      gas: 8000000,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${InfuraKey}`,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    xdai: {
      url: 'https://rpc.xdaichain.com/',
      gasPrice: 1000000000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    matic: {
      url: 'https://rpc-mainnet.maticvigil.com/',
      gasPrice: 1000000000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrum: {
      url: 'https://arb1.arbitrum.io/rpc',
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      companionNetworks: {
        l1: 'mainnet',
      },
    },
    rinkebyArbitrum: {
      url: 'https://rinkeby.arbitrum.io/rpc',
      gasPrice: 30000000, // 0.03 gwei
      gas: 30_000_000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      companionNetworks: {
        l1: 'rinkeby',
      },
    },
    kovanOptimism: {
      url: `https://optimism-kovan.infura.io/v3/${InfuraKey}`,
      gasPrice: 1000000000,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      ovm: true,
      companionNetworks: {
        l1: 'kovan',
      },
    },
    optimism: {
      url: `https://optimism-mainnet.infura.io/v3/${InfuraKey}`,
      gasPrice: 0,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
      ovm: true,
      companionNetworks: {
        l1: 'mainnet',
      },
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.7.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  ovm: {
    solcVersion: '0.7.6',
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  gasReporter: {
    enabled: true,
    showTimeSpent: true,
    currency: 'USD',
    gasPrice: 50,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  preprocess: {
    eachLine: (hre) => ({
      transform: (line: string) => {
        if (line.match(/^\s*import /i)) {
          getRemappings().forEach(([find, replace]) => {
            if (line.match('"' + find)) {
              line = line.replace('"' + find, '"' + replace)
            }
          })
        }
        return line
      },
    }),
  },
  paths: {
    sources: './src',
    cache: './cache_hardhat',
  },
}

function getRemappings() {
  return fs
    .readFileSync('remappings-hardhat.txt', 'utf8')
    .split('\n')
    .filter(Boolean) // remove empty lines
    .map((line: any) => line.trim().split('='))
}

export default config
