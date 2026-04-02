import {
  getTerrainBrushById,
  getTerrainMaterialById,
} from './TerrainMaterialRegistry'
import type {
  TerrainBrushDefinition,
  TerrainBrushId,
  TerrainMaterialDefinition,
} from './TerrainTypes'

const CURSOR_SIZE = 18
const CURSOR_HOTSPOT = 9
const CURSOR_CACHE = new Map<TerrainBrushId, string>()

function buildFillCursorSvg(
  fillMaterial: TerrainMaterialDefinition,
  topMaterial: TerrainMaterialDefinition | null
): string {
  const topPalette = topMaterial?.fillPalette ?? fillMaterial.fillPalette
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${CURSOR_SIZE}' height='${CURSOR_SIZE}' viewBox='0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}' shape-rendering='crispEdges'>
<rect x='1' y='1' width='16' height='16' rx='1' ry='1' fill='${fillMaterial.fillPalette[0]}' stroke='${fillMaterial.strokeColor}' stroke-width='1'/>
<rect x='2' y='2' width='14' height='4' fill='${topPalette[1]}'/>
<rect x='2' y='6' width='7' height='5' fill='${fillMaterial.fillPalette[1]}'/>
<rect x='9' y='6' width='7' height='5' fill='${fillMaterial.fillPalette[2]}'/>
<rect x='2' y='11' width='5' height='5' fill='${fillMaterial.fillPalette[2]}'/>
<rect x='7' y='11' width='5' height='5' fill='${fillMaterial.fillPalette[0]}'/>
<rect x='12' y='11' width='4' height='5' fill='${fillMaterial.fillPalette[1]}'/>
<path d='M9 0V18M0 9H18' stroke='rgba(255,255,255,0.92)' stroke-width='1'/>
<rect x='8' y='8' width='2' height='2' fill='${fillMaterial.strokeColor}'/>
</svg>`
}

function buildEraseCursorSvg(): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${CURSOR_SIZE}' height='${CURSOR_SIZE}' viewBox='0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}' shape-rendering='crispEdges'>
<rect x='1' y='1' width='16' height='16' rx='1' ry='1' fill='rgba(24,18,18,0.45)' stroke='#5f2020' stroke-width='1'/>
<path d='M3 3L15 15M15 3L3 15' stroke='#d85f5f' stroke-width='2'/>
<path d='M9 0V18M0 9H18' stroke='rgba(255,255,255,0.92)' stroke-width='1'/>
</svg>`
}

function buildCursorSvg(brush: TerrainBrushDefinition): string {
  if (brush.mode === 'erase' || !brush.fillMaterialId) {
    return buildEraseCursorSvg()
  }
  const fillMaterial = getTerrainMaterialById(brush.fillMaterialId)
  const topMaterial = brush.exposedTopMaterialId
    ? getTerrainMaterialById(brush.exposedTopMaterialId)
    : null
  return buildFillCursorSvg(fillMaterial, topMaterial)
}

export function getTerrainBrushCursorStyle(brushId: TerrainBrushId): string {
  const cached = CURSOR_CACHE.get(brushId)
  if (cached) {
    return cached
  }
  const brush = getTerrainBrushById(brushId)
  const svg = buildCursorSvg(brush)
  const cursor = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}") ${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}, crosshair`
  CURSOR_CACHE.set(brushId, cursor)
  return cursor
}
