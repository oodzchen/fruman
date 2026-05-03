import type {
  TerrainBrushDefinition,
  TerrainBrushId,
  TerrainMaterialDefinition,
  TerrainMaterialId,
  TerrainMaterialTag,
} from './TerrainTypes'

const TERRAIN_MATERIALS: readonly TerrainMaterialDefinition[] = [
  {
    id: 'dirt',
    code: 1,
    materialTag: 'ground',
    labelKey: 'editor_terrain_brush_dirt',
    breakable: true,
    hardness: 12,
    fillPalette: ['#6f4c2d', '#7a5633', '#5f4024'],
    strokeColor: '#382516',
  },
  {
    id: 'grass',
    code: 2,
    materialTag: 'ground',
    labelKey: 'editor_terrain_brush_grass',
    breakable: true,
    hardness: 14,
    fillPalette: ['#6f9638', '#7eab42', '#5e7f30'],
    strokeColor: '#32451a',
  },
  {
    id: 'stone',
    code: 3,
    materialTag: 'obstacle',
    labelKey: 'editor_terrain_brush_stone',
    breakable: true,
    hardness: 24,
    fillPalette: ['#70737a', '#80848c', '#5f6268'],
    strokeColor: '#3b3d41',
  },
  {
    id: 'wood',
    code: 4,
    materialTag: 'ground',
    labelKey: 'editor_terrain_brush_wood',
    breakable: true,
    hardness: 18,
    fillPalette: ['#84572e', '#946338', '#734a27'],
    strokeColor: '#432712',
  },
  {
    id: 'leaves',
    code: 5,
    materialTag: 'foliage',
    labelKey: 'editor_terrain_brush_leaves',
    breakable: true,
    hardness: 8,
    fillPalette: ['#557a39', '#648a44', '#496930'],
    strokeColor: '#29401b',
  },
  {
    id: 'thatch',
    code: 6,
    materialTag: 'ground',
    labelKey: 'editor_terrain_brush_thatch',
    breakable: true,
    hardness: 6,
    fillPalette: ['#b89030', '#c8a438', '#a47c28'],
    strokeColor: '#5c4010',
  },
] as const

const TERRAIN_BRUSHES: readonly TerrainBrushDefinition[] = [
  {
    id: 'grass',
    labelKey: 'editor_terrain_brush_grass',
    mode: 'fill',
    fillMaterialId: 'grass',
  },
  {
    id: 'dirt',
    labelKey: 'editor_terrain_brush_dirt',
    mode: 'fill',
    fillMaterialId: 'dirt',
  },
  {
    id: 'stone',
    labelKey: 'editor_terrain_brush_stone',
    mode: 'fill',
    fillMaterialId: 'stone',
  },
  {
    id: 'wood',
    labelKey: 'editor_terrain_brush_wood',
    mode: 'fill',
    fillMaterialId: 'wood',
  },
  {
    id: 'leaves',
    labelKey: 'editor_terrain_brush_leaves',
    mode: 'fill',
    fillMaterialId: 'leaves',
  },
  {
    id: 'thatch',
    labelKey: 'editor_terrain_brush_thatch',
    mode: 'fill',
    fillMaterialId: 'thatch',
  },
  {
    id: 'erase',
    labelKey: 'editor_terrain_brush_erase',
    mode: 'erase',
  },
  {
    id: 'contour',
    labelKey: 'editor_terrain_brush_contour',
    mode: 'contour',
  },
] as const

const MATERIAL_BY_ID = new Map<TerrainMaterialId, TerrainMaterialDefinition>()
const MATERIAL_BY_CODE = new Map<number, TerrainMaterialDefinition>()
const BRUSH_BY_ID = new Map<TerrainBrushId, TerrainBrushDefinition>()

for (let i = 0; i < TERRAIN_MATERIALS.length; i++) {
  const material = TERRAIN_MATERIALS[i]
  MATERIAL_BY_ID.set(material.id, material)
  MATERIAL_BY_CODE.set(material.code, material)
}

for (let i = 0; i < TERRAIN_BRUSHES.length; i++) {
  const brush = TERRAIN_BRUSHES[i]
  BRUSH_BY_ID.set(brush.id, brush)
}

export function getTerrainMaterials(): readonly TerrainMaterialDefinition[] {
  return TERRAIN_MATERIALS
}

export function getTerrainBrushes(): readonly TerrainBrushDefinition[] {
  return TERRAIN_BRUSHES
}

export function getTerrainMaterialById(
  id: TerrainMaterialId
): TerrainMaterialDefinition {
  const material = MATERIAL_BY_ID.get(id)
  if (!material) {
    throw new Error(`Unknown terrain material: ${id}`)
  }
  return material
}

export function getTerrainMaterialByCode(
  code: number
): TerrainMaterialDefinition | null {
  return MATERIAL_BY_CODE.get(code) ?? null
}

export function getTerrainBrushById(
  id: TerrainBrushId
): TerrainBrushDefinition {
  const brush = BRUSH_BY_ID.get(id)
  if (!brush) {
    throw new Error(`Unknown terrain brush: ${id}`)
  }
  return brush
}

export function getTerrainMaterialCodeById(id: TerrainMaterialId): number {
  return getTerrainMaterialById(id).code
}

export function getTerrainMaterialTagById(
  id: TerrainMaterialId
): TerrainMaterialTag {
  return getTerrainMaterialById(id).materialTag
}

export function getTerrainMaterialTagByCode(
  code: number
): TerrainMaterialTag | null {
  const material = getTerrainMaterialByCode(code)
  return material ? material.materialTag : null
}

export function isSolidTerrainCode(code: number): boolean {
  return code > 0
}
