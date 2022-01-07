import { expect } from "chai";
import { ethers } from "hardhat";
import { TraderVaultTester } from '../typechain'

describe("TraderVault", function () {
  let tester: TraderVaultTester

  beforeEach(async () => {
    const TraderVault = await ethers.getContractFactory('TraderVault')
    const traderVault = await TraderVault.deploy()


    const TraderVaultTester = await ethers.getContractFactory('TraderVaultTester', {
      libraries: {
        TraderVault: traderVault.address
      }
    })

    tester = (await TraderVaultTester.deploy()) as TraderVaultTester
  })

  describe("checkIM", () => {
    it("request withdrawal all but more collateral required", async function () {
      await tester.testSet('100000000', '0', '10000000000000000', '0', '0')
      await tester.testCheckIM('100000000', '110000000', 0)
      const r = await tester.r()
      expect(r).to.be.eq(120000)
    })

    it("withdraw all", async function () {
      await tester.testSet('100000000', '0', '10000000000000000', '0', '200000')
      await tester.testCheckIM('100000000', '110000000', 0)
      const r = await tester.r()
      expect(r).to.be.eq(-80000)
    })

  })
})
