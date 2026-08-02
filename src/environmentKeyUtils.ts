export const DEFAULT_ENVIRONMENT_KEY_TEXT = 'W'
export const MAX_ENVIRONMENT_KEY_TEXT_LENGTH = 16

export function normalizeEnvironmentKeyText(
  value: string | null | undefined
): string {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) {
    return DEFAULT_ENVIRONMENT_KEY_TEXT
  }
  if (trimmed.length <= MAX_ENVIRONMENT_KEY_TEXT_LENGTH) {
    return trimmed
  }
  return trimmed.slice(0, MAX_ENVIRONMENT_KEY_TEXT_LENGTH)
}

export function getEnvironmentKeyTextLength(value: string): number {
  let length = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const nextCode = value.charCodeAt(i + 1)
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        i++
      }
    }
    length++
  }
  return length
}
