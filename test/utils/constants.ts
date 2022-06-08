export const SAFETY_BLOCK_PERIOD = 18
export const VARIANCE_UPDATE_INTERVAL = 12 * 60 * 60
// arbitrum mines 12 blocks per minute
export const VARIANCE_UPDATE_BLOCK_INTERVAL = 12 * 60 * 12
export const BLOCKS_PER_DAY = 12 * 60 * 24
export const FUNDING_PERIOD = 24 * 60 * 60
export const FUNDING_BLOCK_PERIOD = 24 * 60 * 24

export const FUTURE_PRODUCT_ID = 0
export const SQUEETH_PRODUCT_ID = 1
export const MAX_PRODUCT_ID = 2

export const MAX_WITHDRAW_AMOUNT = '-1000000000000000000'
export const MIN_MARGIN = '1000000000'

export enum MarginChange {
  ShortToShort = 0,
  ShortToLong,
  LongToLong,
  LongToShort,
}
