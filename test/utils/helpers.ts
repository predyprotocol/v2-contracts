import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'

export const scaledBN = (a: number, b: number) => BigNumber.from(a).mul(BigNumber.from(10).pow(b))

export const div = (a: BigNumber, b: BigNumberish, roundUp?: boolean) => {
  const r = a.div(b)
  if (roundUp && !a.mod(b).eq(0)) {
    return r.add(1)
  }
  return r
}

export const increaseTime = async (time: number) => {
  await ethers.provider.send('evm_increaseTime', [time])
  await ethers.provider.send('evm_mine', [])
}

export const setTime = async (time: number) => {
  await ethers.provider.send('evm_setNextBlockTimestamp', [time])
  await ethers.provider.send('evm_mine', [])
}

export const getBlocktime = async () => {
  const block = await ethers.provider.getBlock('latest')
  return block.timestamp
}

export const getExpiry = async (date: number) => {
  const blockTime = await getBlocktime()
  const expiry = blockTime + date * (60 * 60 * 24)
  const remain = expiry % (60 * 60 * 24)
  return expiry - remain
}

export function genRangeId(s: number, e: number): number {
  return s + 1e2 * e
}
