export type EnvironmentCratePlankRole = 'frame' | 'panel'

export interface EnvironmentCratePlankLayout {
  readonly localCenterX: number
  readonly localCenterY: number
  readonly width: number
  readonly height: number
  readonly role: EnvironmentCratePlankRole
  readonly debrisVariant: number
}

export interface EnvironmentCrateLayout {
  readonly width: number
  readonly height: number
  readonly frameInset: number
  readonly plankGap: number
  readonly planks: readonly EnvironmentCratePlankLayout[]
}

const ENV_SEED_MIX = 0x9e3779b9 | 0

function lcgStep(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) | 0
}

function lcgRange(seed: number, min: number, max: number): number {
  const range = max - min + 1
  return min + ((seed >>> 0) % range)
}

function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0
  }
  if (numerator < 0) {
    return -(((-numerator + (denominator >> 1)) / denominator) | 0)
  }
  return ((numerator + (denominator >> 1)) / denominator) | 0
}

export function createEnvironmentCrateLayout(
  seed: number,
  pixelsPerMeter: number
): EnvironmentCrateLayout {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const widthNum = lcgRange(s, 90, 135)
  s = lcgStep(s)
  const heightNum = lcgRange(s, 75, 120)
  s = lcgStep(s)
  const frameInsetNum = lcgRange(s, 12, 20)
  s = lcgStep(s)
  const plankGapNum = lcgRange(s, 8, 14)

  const width = Math.max(20, roundDiv(pixelsPerMeter * widthNum, 100))
  const height = Math.max(18, roundDiv(pixelsPerMeter * heightNum, 100))
  const halfWidth = width >> 1
  const frameInset = Math.max(3, roundDiv(width * frameInsetNum, 100))
  const plankGap = Math.max(2, roundDiv(width * plankGapNum, 100))
  const topBandHeight = Math.max(2, frameInset)
  const sideBandWidth = Math.max(2, roundDiv(frameInset * 7, 10))
  const bottomBandHeight = Math.max(2, roundDiv(frameInset * 6, 5))
  const topY = -height
  const leftX = -halfWidth
  const rightX = leftX + width
  const innerLeftX = leftX + frameInset
  const innerTopY = topY + frameInset
  const innerWidth = Math.max(4, width - frameInset * 2)
  const innerHeight = Math.max(4, height - frameInset * 2)
  const panelWidthTotal = Math.max(4, innerWidth - plankGap)
  const leftPanelWidth = Math.max(2, panelWidthTotal >> 1)
  const rightPanelWidth = Math.max(2, panelWidthTotal - leftPanelWidth)
  const rightPanelX = innerLeftX + leftPanelWidth + plankGap
  const bodyCenterY = topY + (height >> 1)
  const panelCenterY = innerTopY + (innerHeight >> 1)

  const planks: EnvironmentCratePlankLayout[] = [
    {
      localCenterX: 0,
      localCenterY: topY + (topBandHeight >> 1),
      width,
      height: topBandHeight,
      role: 'frame',
      debrisVariant: 4,
    },
    {
      localCenterX: 0,
      localCenterY: -(bottomBandHeight >> 1),
      width,
      height: bottomBandHeight,
      role: 'frame',
      debrisVariant: 4,
    },
    {
      localCenterX: leftX + (sideBandWidth >> 1),
      localCenterY: bodyCenterY,
      width: sideBandWidth,
      height,
      role: 'frame',
      debrisVariant: 5,
    },
    {
      localCenterX: rightX - (sideBandWidth >> 1),
      localCenterY: bodyCenterY,
      width: sideBandWidth,
      height,
      role: 'frame',
      debrisVariant: 5,
    },
    {
      localCenterX: innerLeftX + (leftPanelWidth >> 1),
      localCenterY: panelCenterY,
      width: leftPanelWidth,
      height: innerHeight,
      role: 'panel',
      debrisVariant: 5,
    },
    {
      localCenterX: rightPanelX + (rightPanelWidth >> 1),
      localCenterY: panelCenterY,
      width: rightPanelWidth,
      height: innerHeight,
      role: 'panel',
      debrisVariant: 5,
    },
  ]

  return {
    width,
    height,
    frameInset,
    plankGap,
    planks,
  }
}
