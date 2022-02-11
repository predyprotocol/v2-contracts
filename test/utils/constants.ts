import { ethers } from 'ethers'

export const SAFETY_PERIOD = 6 * 60
export const VARIANCE_UPDATE_INTERVAL = 12 * 60 * 60

export const SQUEETH_PRODUCT_ID = 0
export const FUTURE_PRODUCT_ID = 1

export const MAX_WITHDRAW_AMOUNT = ethers.constants.MinInt256.div(100)
