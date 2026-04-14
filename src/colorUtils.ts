const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/
const OPAQUE_ALPHA = 255

function normalizeMaybeHexColor(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
    return null
  }
  return value.toLowerCase()
}

function clampColorAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) {
    return OPAQUE_ALPHA
  }
  const rounded = Math.round(alpha)
  if (rounded <= 0) {
    return 0
  }
  if (rounded >= OPAQUE_ALPHA) {
    return OPAQUE_ALPHA
  }
  return rounded
}

export function isHexColorString(
  value: string | null | undefined
): value is string {
  return normalizeMaybeHexColor(value) !== null
}

export function normalizeHexColor(
  value: string | null | undefined,
  fallback = '#000000'
): string {
  return (
    normalizeMaybeHexColor(value) ??
    normalizeMaybeHexColor(fallback) ??
    '#000000'
  )
}

export function splitHexColor(
  value: string | null | undefined,
  fallback = '#000000'
): { rgbHex: string; alpha: number } {
  const normalized = normalizeHexColor(value, fallback)
  return {
    rgbHex: normalized.slice(0, 7),
    alpha:
      normalized.length === 9
        ? Number.parseInt(normalized.slice(7, 9), 16)
        : OPAQUE_ALPHA,
  }
}

export function composeHexColor(rgbHex: string, alpha = OPAQUE_ALPHA): string {
  const normalizedRgb = normalizeHexColor(rgbHex, '#000000').slice(0, 7)
  const clampedAlpha = clampColorAlpha(alpha)
  if (clampedAlpha >= OPAQUE_ALPHA) {
    return normalizedRgb
  }
  const alphaHex = clampedAlpha.toString(16).padStart(2, '0')
  return `${normalizedRgb}${alphaHex}`
}
