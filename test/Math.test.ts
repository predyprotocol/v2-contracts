import { expect } from 'chai'
import { constants } from 'ethers'
import { ethers } from 'hardhat'
import { MathTester } from '../typechain'
import { assertCloseToPercentage, numToBn } from './utils/helpers'

describe('Math', function () {
  let tester: MathTester

  beforeEach(async () => {
    const MathTester = await ethers.getContractFactory('MathTester')

    tester = (await MathTester.deploy()) as MathTester
  })

  describe('addDelta', () => {
    it('reverts on overflow because y is too small', async () => {
      await expect(tester.testAddDelta(0, -1)).to.be.revertedWith('M0')
    })

    it('reverts on overflow because y is too large', async () => {
      await expect(tester.testAddDelta(constants.MaxUint256, 1)).to.be.revertedWith('M1')
    })
  })

  describe('scale', () => {
    it('scale small number from decimal 6 to 2', async () => {
      const result = await tester.testScale('12345', 6, 3)

      expect(result).to.be.eq(12)
    })

    it('scale decimal 6 to 2', async () => {
      const result = await tester.testScale('123000000', 6, 2)

      expect(result).to.be.eq(12300)
    })

    it('scale decimal 2 to 6', async () => {
      const result = await tester.testScale('123', 2, 6)

      expect(result).to.be.eq(1230000)
    })

    it('scale decimal 6 to 6', async () => {
      const result = await tester.testScale('12345', 6, 6)

      expect(result).to.be.eq(12345)
    })

    it('reverts on overflow', async () => {
      await expect(tester.testScale('12345', 6, 80)).to.be.revertedWith('M2')
    })
  })

  describe('log', async () => {
    const logTests = [0.9, 1, 1.01, 1.1, 2, 5, 10, 100]

    it('returns a correct value for a number of cases', async () => {
      const decimals = 8

      for (const value of logTests) {
        const result = await tester.testLog(numToBn(value, decimals))
        const expected = Math.log(value)

        assertCloseToPercentage(result, numToBn(expected, decimals))
      }
    })

    it('reverts on overflow', async () => {
      await expect(tester.testLog(constants.MaxInt256)).to.be.revertedWith('SignedSafeMath: addition overflow')
    })
  })

  describe('exp', async () => {
    const logTests = [-70, -10, -1, 0, 1, 1.1, 2, 10]

    it('returns a correct value for a number of cases', async () => {
      const decimals = 8

      for (const value of logTests) {
        const result = await tester.testExp(numToBn(value, decimals))
        const expected = Math.exp(value)

        assertCloseToPercentage(result, numToBn(expected, decimals))
      }
    })

    it('reverts on overflow', async () => {
      await expect(tester.testExp(constants.MaxInt256)).to.be.revertedWith('M4')
    })
  })
})
