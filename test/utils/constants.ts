import { ethers } from 'ethers'

export const SAFETY_PERIOD = 6 * 60
export const VARIANCE_UPDATE_INTERVAL = 12 * 60 * 60
export const FUNDING_PERIOD = 24 * 60 * 60

export const FUTURE_PRODUCT_ID = 0
export const SQUEETH_PRODUCT_ID = 1

export const MAX_WITHDRAW_AMOUNT = '-1000000000000000000'
export const MIN_MARGIN = '1000000000'

export enum MarginChange {
  ShortToShort = 0,
  ShortToLong,
  LongToLong,
  LongToShort,
}
