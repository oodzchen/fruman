export const CHARACTER_DEBUG_PROTECTION_AVAILABLE = import.meta.env.DEV

export function resolveCharacterDebugProtection(
  enabled: boolean | undefined
): boolean {
  return CHARACTER_DEBUG_PROTECTION_AVAILABLE && enabled === true
}
