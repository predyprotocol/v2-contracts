import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MathTester } from '../typechain'

describe('Math', function () {
  let tester: MathTester

  beforeEach(async () => {
    const MathTester = await ethers.getContractFactory('MathTester')

    tester = (await MathTester.deploy()) as MathTester
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
  })
})
