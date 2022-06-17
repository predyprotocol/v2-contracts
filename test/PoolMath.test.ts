import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { PoolMathTester } from '../typechain'
import { assertCloseToPercentage, numToBn } from './utils/helpers'

describe('PoolMath', function () {
  let tester: PoolMathTester

  beforeEach(async () => {
    const PoolMathTester = await ethers.getContractFactory('PoolMathTester')

    tester = (await PoolMathTester.deploy()) as PoolMathTester
  })

  describe('calculateMarginDivLiquidity', () => {
    const decimals = 16
    const K = 3

    function fundingRateFormula(m: number, dm: number, l: number, dl: number) {
      return (K * marginDivLiquidity(m, dm, l, dl) + (10 - K) * marginDivLiquidity3(m, dm, l, dl)) / 10
    }

    function marginDivLiquidity3(m: number, dm: number, l: number, dl: number) {
      let result = m * m * m + (3 * m * m * dm) / 2 + m * dm * dm + (dm * dm * dm) / 4

      return (result * (l + dl / 2)) / (l * l * (l + dl) * (l + dl))
    }

    function marginDivLiquidity(m: number, dm: number, l: number, dl: number) {
      if (dl == 0) {
        return (m + dm / 2) / l
      } else {
        return ((m + dm / 2) * (Math.log(l + dl) - Math.log(l))) / dl
      }
    }

    it('reverts if liquidity is 0', async () => {
      await expect(tester.verifyCalculateFundingRateFormula(0, 0, 0, 0)).to.be.revertedWith('l must be positive')
    })

    it('return a correct value', async () => {
      const testValuesOfLiquidity = [
        [500, 0],
        [500, 10],
        [500, 20],
        [500, -10],
        [500, -20],
      ]
      const testValuesOfMargin = [
        [20, 380],
        [20, 40],
        [20, 20],
        [20, 0],
        [20, -10],
        [20, -20],
        [20, -30],
        [20, -100],
        [-20, -380],
        [-20, -40],
        [-20, -20],
        [-20, 0],
        [-20, 10],
        [-20, 20],
        [-20, 30],
        [-20, 100],
      ]

      for (let testValueOfLiquidity of testValuesOfLiquidity) {
        for (let testValueOfMargin of testValuesOfMargin) {
          const expected = fundingRateFormula(
            testValueOfMargin[0],
            testValueOfMargin[1],
            testValueOfLiquidity[0],
            testValueOfLiquidity[1],
          )
          const result = await tester.verifyCalculateFundingRateFormula(
            numToBn(testValueOfMargin[0], decimals),
            numToBn(testValueOfMargin[1], decimals),
            numToBn(testValueOfLiquidity[0], decimals),
            numToBn(testValueOfLiquidity[1], decimals),
          )

          assertCloseToPercentage(result, numToBn(expected, decimals), BigNumber.from('100000'))
        }
      }
    })
  })
})
