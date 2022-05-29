import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { TraderVaultLibTester } from '../typechain'
import { FUTURE_PRODUCT_ID, SQUEETH_PRODUCT_ID } from './utils/constants'
import { scaledBN, numToBn, calculateMinCollateral, assertCloseToPercentage } from './utils/helpers'

type TestData = ({ positionPerpetual: number; tradePrice: number; entryFundingFee: number } | null)[][]

type ExpectedData = {
  positionUsdc: number
  subVaults: {
    positionPerpetuals: number[]
    entryPrices: number[]
    entryFundingFee: number[]
  }[]
}

type TestCase = {
  testData: TestData
  expectedData: ExpectedData
}

describe('TraderVaultLib', function () {
  let tester: TraderVaultLibTester

  beforeEach(async () => {
    const TraderVaultLib = await ethers.getContractFactory('TraderVaultLib')
    const traderVaultLib = await TraderVaultLib.deploy()

    const TraderVaultLibTester = await ethers.getContractFactory('TraderVaultLibTester', {
      libraries: {
        TraderVaultLib: traderVaultLib.address,
      },
    })
    tester = (await TraderVaultLibTester.deploy()) as TraderVaultLibTester
  })

  describe('updateVault', () => {
    const checkUpdateVaults = async (testCases: TestCase[]) => {
      for (let testCase of testCases) {
        await checkUpdateVault(testCase.testData, testCase.expectedData)
      }
    }

    const checkUpdateVault = async (
      testData: ({ positionPerpetual: number; tradePrice: number; entryFundingFee: number } | null)[][],
      expectedData: {
        positionUsdc: number
        subVaults: {
          positionPerpetuals: number[]
          entryPrices: number[]
          entryFundingFee: number[]
        }[]
      },
    ) => {
      for (let i = 0; i < testData.length; i++) {
        for (let j = 0; j < 2; j++) {
          const testTradeData = testData[i][j]
          if (testTradeData !== null) {
            await tester.testUpdateVault(
              i,
              j,
              numToBn(testTradeData.positionPerpetual, 8),
              numToBn(testTradeData.tradePrice, 8),
              numToBn(testTradeData.entryFundingFee, 16),
            )
          }
        }
      }

      const vaultPositionUsdc = await tester.traderVault()
      expect(vaultPositionUsdc).to.be.eq(numToBn(expectedData.positionUsdc, 8))

      for (let i = 0; i < expectedData.subVaults.length; i++) {
        const expectedSubVault = expectedData.subVaults[i]
        const subVault = await tester.getSubVault(i)
        for (let j = 0; j < 2; j++) {
          expect(subVault.positionPerpetuals[j]).to.be.eq(numToBn(expectedSubVault.positionPerpetuals[j], 8))
          expect(subVault.entryPrices[j]).to.be.eq(numToBn(expectedSubVault.entryPrices[j], 8))
          expect(subVault.entryFundingFee[j]).to.be.eq(numToBn(expectedSubVault.entryFundingFee[j], 16))
        }
      }
    }

    it('single sub-vault', async function () {
      const testCases = [
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 100, entryFundingFee: 10 }]],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [0, 1], entryPrices: [0, 100], entryFundingFee: [0, 10] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 100, entryFundingFee: 10 }]],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [0, 2], entryPrices: [0, 100], entryFundingFee: [0, 10] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [0, 3], entryPrices: [0, 110], entryFundingFee: [0, 12] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: -1, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 16,
            subVaults: [{ positionPerpetuals: [0, 2], entryPrices: [0, 110], entryFundingFee: [0, 12] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: -3, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 48,
            subVaults: [{ positionPerpetuals: [0, -1], entryPrices: [0, 130], entryFundingFee: [0, 16] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 150, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 28,
            subVaults: [{ positionPerpetuals: [0, 0], entryPrices: [0, 0], entryFundingFee: [0, 0] }],
          },
        },
      ]

      await checkUpdateVaults(testCases)
    })

    it('multiple products', async function () {
      const testCases = [
        {
          testData: [
            [
              { positionPerpetual: 1, tradePrice: 1000, entryFundingFee: 10 },
              { positionPerpetual: 1, tradePrice: 100, entryFundingFee: 10 },
            ],
          ],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [1, 1], entryPrices: [1000, 100], entryFundingFee: [10, 10] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 100, entryFundingFee: 10 }]],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [1, 2], entryPrices: [1000, 100], entryFundingFee: [10, 10] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: 1, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 0,
            subVaults: [{ positionPerpetuals: [1, 3], entryPrices: [1000, 110], entryFundingFee: [10, 12] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: -1, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 16,
            subVaults: [{ positionPerpetuals: [1, 2], entryPrices: [1000, 110], entryFundingFee: [10, 12] }],
          },
        },
        {
          testData: [[null, { positionPerpetual: -3, tradePrice: 130, entryFundingFee: 16 }]],
          expectedData: {
            positionUsdc: 48,
            subVaults: [{ positionPerpetuals: [1, -1], entryPrices: [1000, 130], entryFundingFee: [10, 16] }],
          },
        },
        {
          testData: [
            [
              { positionPerpetual: -1, tradePrice: 1000, entryFundingFee: 11 },
              { positionPerpetual: 1, tradePrice: 150, entryFundingFee: 16 },
            ],
          ],
          expectedData: {
            positionUsdc: 27,
            subVaults: [{ positionPerpetuals: [0, 0], entryPrices: [0, 0], entryFundingFee: [0, 0] }],
          },
        },
      ]

      await checkUpdateVaults(testCases)
    })

    it('multiple sub-vaults', async function () {
      const testCases = [
        {
          testData: [
            [{ positionPerpetual: 1, tradePrice: 1000, entryFundingFee: 10 }, null],
            [{ positionPerpetual: -1, tradePrice: 1000, entryFundingFee: 10 }, null],
          ],
          expectedData: {
            positionUsdc: 0,
            subVaults: [
              { positionPerpetuals: [1, 0], entryPrices: [1000, 0], entryFundingFee: [10, 0] },
              { positionPerpetuals: [-1, 0], entryPrices: [1000, 0], entryFundingFee: [10, 0] },
            ],
          },
        },
        {
          testData: [
            [{ positionPerpetual: -1, tradePrice: 1100, entryFundingFee: 20 }, null],
            [{ positionPerpetual: 1, tradePrice: 1100, entryFundingFee: 20 }, null],
          ],
          expectedData: {
            positionUsdc: 0,
            subVaults: [
              { positionPerpetuals: [0, 0], entryPrices: [0, 0], entryFundingFee: [0, 0] },
              { positionPerpetuals: [0, 0], entryPrices: [0, 0], entryFundingFee: [0, 0] },
            ],
          },
        },
      ]

      await checkUpdateVaults(testCases)
    })

    it('reverts if sub-vault index is too large', async function () {
      await expect(tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')).to.be.revertedWith(
        'T3',
      )
    })
  })

  describe('getMinCollateral', () => {
    const spots = [1000, 2000, 3000, 4000, 5000]

    async function checkMinCollaterals(subVaults: number[][], fundingRates: number[]) {
      for (let spot of spots) {
        await checkMinCollateral(subVaults, fundingRates, spot)
      }
    }

    async function checkMinCollateral(subVaults: number[][], fundingRates: number[], spotPrice: number) {
      const futurePrice = spotPrice * (1 + fundingRates[0])
      const squeethPrice = (spotPrice * spotPrice * (1 + fundingRates[1])) / 10000

      let positionFuture = 0
      let positionSqueeth = 0

      for (let i = 0; i < subVaults.length; i++) {
        if (subVaults[i][0] !== 0) {
          await tester.testUpdateVault(i, FUTURE_PRODUCT_ID, numToBn(subVaults[i][0], 8), numToBn(futurePrice, 8), '0')
          positionFuture += subVaults[i][0]
        }
        if (subVaults[i][1] !== 0) {
          await tester.testUpdateVault(
            i,
            SQUEETH_PRODUCT_ID,
            numToBn(subVaults[i][1], 8),
            numToBn(squeethPrice, 8),
            '0',
          )
          positionSqueeth += subVaults[i][1]
        }
      }
      const minCollateral = await tester.getMinCollateral({
        spotPrice: numToBn(spotPrice, 8),
        tradePrices: [numToBn(futurePrice, 8), numToBn(squeethPrice, 8)],
        fundingRates: [numToBn(fundingRates[0], 16), numToBn(fundingRates[1], 16)],
        amountsFundingPaidPerPosition: [0, 0],
      })
      const expectedMinCollateral = calculateMinCollateral(
        positionFuture,
        positionSqueeth,
        fundingRates[0],
        fundingRates[1],
        spotPrice,
      )

      assertCloseToPercentage(minCollateral, numToBn(expectedMinCollateral, 8), BigNumber.from('100'))

      await tester.clear()
    }

    describe('single sub-vault', () => {
      it('future', async function () {
        await checkMinCollaterals([[1, 0]], [0, 0])
        await checkMinCollaterals([[-1, 0]], [0, 0])
        await checkMinCollaterals([[1, 0]], [0.001, 0])
      })

      it('squeeth', async function () {
        await checkMinCollaterals([[0, 2]], [0, 0])
        await checkMinCollaterals([[0, -2]], [0, 0])
        await checkMinCollaterals([[0, 2]], [0, 0.01])
      })

      it('future and squeeth', async function () {
        await checkMinCollaterals([[1, 2]], [0, 0])
        await checkMinCollaterals([[1, -2]], [0, 0])
        await checkMinCollaterals([[-1, 2]], [0, 0])
        await checkMinCollaterals([[-1, -2]], [0, 0])
        await checkMinCollaterals([[1, 2]], [0.001, 0.01])
      })
    })

    describe('multiple sub-vaults', () => {
      it('future', async function () {
        await checkMinCollaterals(
          [
            [1, 0],
            [1, 0],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [-1, 0],
            [-1, 0],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [1, 0],
            [-1, 0],
          ],
          [0, 0],
        )
      })
      it('squeeth', async function () {
        await checkMinCollaterals(
          [
            [0, 1],
            [0, 1],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [0, -1],
            [0, -1],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [0, 1],
            [0, -1],
          ],
          [0, 0],
        )
      })

      it('future and squeeth', async function () {
        await checkMinCollaterals(
          [
            [1, 0],
            [0, 2],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [-1, 0],
            [0, 2],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [1, 0],
            [0, -2],
          ],
          [0, 0],
        )
        await checkMinCollaterals(
          [
            [-1, 0],
            [0, -2],
          ],
          [0, 0],
        )
      })
    })
  })

  describe('getPositionValue', () => {
    afterEach(async () => {
      // Close all positions
      const numOfSubVaults = await tester.getNumOfSubVault()
      for (let i = 0; i < numOfSubVaults.toNumber(); i++) {
        const subVault = await tester.getSubVault(i)
        if (!subVault.positionPerpetuals[SQUEETH_PRODUCT_ID].eq(0)) {
          await tester.testUpdateVault(
            i,
            SQUEETH_PRODUCT_ID,
            -subVault.positionPerpetuals[SQUEETH_PRODUCT_ID],
            '10000000000',
            '1000',
          )
        }
        if (!subVault.positionPerpetuals[FUTURE_PRODUCT_ID].eq(0)) {
          await tester.testUpdateVault(
            i,
            FUTURE_PRODUCT_ID,
            -subVault.positionPerpetuals[FUTURE_PRODUCT_ID],
            '100000000000',
            '1000',
          )
        }
      }

      // Check that positionUsdc is equal to positionValue when all positions are closed
      const positionValue = await tester.getPositionValue({
        spotPrice: '100000000000',
        tradePrices: ['10000000000', '100000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [1000, 1000],
      })

      expect(await tester.traderVault()).to.be.eq(positionValue)
    })

    describe('ETH price becomes high', () => {
      it('1 long squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '11000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(2100000000)
      })

      it('1 short squeeth', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-2100000000)
      })

      it('1 long future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(10000000000)
      })

      it('1 short future', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(-10000000000)
      })

      it('1 long squeeth and 0.2 short future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-20000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(100000000)
      })

      it('1 short squeeth and 1 long future', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })

      it('1 short squeeth and 1 long future in different sub-vaults', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')
        await tester.testUpdateVault(1, FUTURE_PRODUCT_ID, '50000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(positionValue).to.be.eq(7900000000)
      })
    })

    describe('funding fee', () => {
      it('1 long squeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, scaledBN(1000000, 8)],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short squeeth and positive funding fee', async function () {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '-100000000', '10000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, scaledBN(1000000, 8)],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [scaledBN(1000000, 8), 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })

      it('1 short future and positive funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [scaledBN(1000000, 8), 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 long future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [scaledBN(-1000000, 8), 0],
        })
        expect(positionValue).to.be.eq(1000000)
      })

      it('1 short future and negative funding fee', async function () {
        await tester.testUpdateVault(0, FUTURE_PRODUCT_ID, '-100000000', '100000000000', '0')

        const positionValue = await tester.getPositionValue({
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [scaledBN(-1000000, 8), 0],
        })
        expect(positionValue).to.be.eq(-1000000)
      })
    })
  })

  describe('getMinCollateralToAddPosition', () => {
    it('get min collateral of the vault', async function () {
      const minCollateral = await tester.testGetMinCollateralToAddPosition([0, '1000000000'], {
        spotPrice: '100000000000',
        tradePrices: ['100000000000', '10000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [0, 0],
      })
      expect(minCollateral).to.be.eq('20000000000')
    })

    describe('USDCs are deposited', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('50000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('get min collateral of the vault which has positions', async function () {
        const minCollateral = await tester.testGetMinCollateralToAddPosition([0, '1000000000'], {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(minCollateral).to.be.eq('21000000000')
      })
    })
  })

  describe('updateUsdcPosition', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '1000000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('100000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('100000000000')
        expect(await tester.traderVault()).to.be.eq(100000000000)
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('100000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-200000000000', {
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-101000000000')
        expect(await tester.traderVault()).to.be.eq('-1000000000')
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '5000000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '5000000000', '10000000000', '0')
      })

      it('more collateral required', async function () {
        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('200000000000')
        expect(await tester.traderVault()).to.be.eq('200000000000')
      })

      it('there is excess collateral', async function () {
        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        await tester.testUpdateUsdcPosition('-500000000000', {
          spotPrice: '110000000000',
          tradePrices: ['110000000000', '12100000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
        expect(await tester.r()).to.be.eq('-282950000000')
        expect(await tester.traderVault()).to.be.eq('-82950000000')
      })
    })
  })

  describe('checkVaultIsLiquidatable', () => {
    describe('single sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '7000000000', '10000000000', '0')
        await tester.testUpdateUsdcPosition('73500000000', {
          spotPrice: '100000000000',
          tradePrices: ['100000000000', '10000000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '95000000000',
            tradePrices: ['95000000000', '9025000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.true
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [scaledBN(500000000, 8), scaledBN(500000000, 8)],
          }),
        ).to.be.true
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })

    describe('multiple sub-vault', () => {
      beforeEach(async () => {
        await tester.testUpdateVault(0, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')
        await tester.testUpdateVault(1, SQUEETH_PRODUCT_ID, '50000000', '10000000000', '0')

        await tester.testUpdateUsdcPosition('200000000000', {
          spotPrice: '95000000000',
          tradePrices: ['95000000000', '9025000000'],
          fundingRates: [0, 0],
          amountsFundingPaidPerPosition: [0, 0],
        })
      })

      it('returns true if position value is less than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })

      it('returns false if position value is greater than min collateral', async function () {
        expect(
          await tester.testCheckVaultIsLiquidatable({
            spotPrice: '100000000000',
            tradePrices: ['100000000000', '10000000000'],
            fundingRates: [0, 0],
            amountsFundingPaidPerPosition: [0, 0],
          }),
        ).to.be.false
      })
    })
  })

  describe('decreaseLiquidationReward', () => {
    const liquidationFee = 2000

    beforeEach(async () => {
      await tester.testUpdateUsdcPosition('200000000', {
        spotPrice: '100000000000',
        tradePrices: ['100000000000', '10000000000'],
        fundingRates: [0, 0],
        amountsFundingPaidPerPosition: [0, 0],
      })
    })

    it('reward is 0.2 of MinCollateral', async function () {
      await tester.testDecreaseLiquidationReward(scaledBN(10, 8), liquidationFee)
      expect(await tester.r()).to.be.eq(200000000)
      expect(await tester.traderVault()).to.be.eq(0)
    })

    it('reward is equal to usdcPosition', async function () {
      await tester.testDecreaseLiquidationReward(scaledBN(5, 7), liquidationFee)
      expect(await tester.r()).to.be.eq(10000000)
      expect(await tester.traderVault()).to.be.eq(190000000)
    })
  })
})
