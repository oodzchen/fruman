import type { EditorMapData, MapEnvironmentObject } from '../editorMapTypes'

export function buildRuntimeEnvironmentObjects(
  envObjects: readonly MapEnvironmentObject[] | undefined,
  brokenEnvironmentIndices: ReadonlySet<number>
): MapEnvironmentObject[] | undefined {
  if (!envObjects || envObjects.length === 0) {
    return envObjects ? [] : undefined
  }
  const nextObjects = new Array<MapEnvironmentObject>(envObjects.length)
  for (let i = 0; i < envObjects.length; i++) {
    const obj = envObjects[i]
    if (obj.type === 'crate' || brokenEnvironmentIndices.has(i)) {
      nextObjects[i] = { ...obj, hidden: true }
    } else {
      nextObjects[i] = obj
    }
  }
  return nextObjects
}

export function buildRuntimeMapData(
  map: EditorMapData | null | undefined,
  brokenEnvironmentIndices: ReadonlySet<number>
): EditorMapData | null {
  if (!map) {
    return null
  }
  return {
    ...map,
    environmentObjects: buildRuntimeEnvironmentObjects(
      map.environmentObjects,
      brokenEnvironmentIndices
    ),
  }
}
