import { timingSafeEqual } from 'node:crypto'

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
