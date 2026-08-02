import type {
  MapEnvironmentKeyMouseAction,
  MapEnvironmentKeyVariant,
} from './editorMapTypes'

export const DEFAULT_ENVIRONMENT_KEY_TEXT = 'W'
export const MAX_ENVIRONMENT_KEY_TEXT_LENGTH = 16
export const DEFAULT_ENVIRONMENT_MOUSE_ACTION: MapEnvironmentKeyMouseAction =
  'left'

export const ENVIRONMENT_MOUSE_ACTIONS: readonly MapEnvironmentKeyMouseAction[] =
  ['left', 'middle', 'right', 'wheelDown', 'wheelUp']

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

export function normalizeEnvironmentMouseAction(
  value: MapEnvironmentKeyMouseAction | undefined
): MapEnvironmentKeyMouseAction {
  for (let i = 0; i < ENVIRONMENT_MOUSE_ACTIONS.length; i++) {
    if (ENVIRONMENT_MOUSE_ACTIONS[i] === value) {
      return value
    }
  }
  return DEFAULT_ENVIRONMENT_MOUSE_ACTION
}

export function cloneEnvironmentKeyVariants(
  variants: readonly MapEnvironmentKeyVariant[] | null | undefined
): MapEnvironmentKeyVariant[] {
  if (!variants || variants.length === 0) {
    return []
  }
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].type === 'mouse') {
      return [
        {
          type: 'mouse',
          action: normalizeEnvironmentMouseAction(variants[i].action),
        },
      ]
    }
  }
  return []
}

export function getEnvironmentMouseVariant(
  variants: readonly MapEnvironmentKeyVariant[] | null | undefined
): MapEnvironmentKeyVariant | null {
  if (!variants) {
    return null
  }
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].type === 'mouse') {
      return variants[i]
    }
  }
  return null
}

export function areEnvironmentKeyVariantsEqual(
  left: readonly MapEnvironmentKeyVariant[],
  right: readonly MapEnvironmentKeyVariant[]
): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i].type !== right[i].type || left[i].action !== right[i].action) {
      return false
    }
  }
  return true
}
