import {
  getDefaultTerrainRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import {
  getTerrainChunkMaterialCodes,
  getTerrainLayerViews,
} from './TerrainDataUtils'
import {
  getTerrainMaterialTagByCode,
  getTerrainMaterialTagById,
  isSolidTerrainCode,
} from './TerrainMaterialRegistry'
import type { TerrainDataLike } from './TerrainTypes'

export interface TerrainEdgeProtectionWall {
  x: number
  y: number
  interiorX: number
  interiorY: number
  renderLayer: number
}

interface BoundaryEdge {
  startX: number
  startY: number
  endX: number
  endY: number
  startKey: string
  endKey: string
  renderLayer: number
  edgeProtection: boolean
  support: boolean
}

const COORDINATE_SCALE = 1024
const cellPoints = new Array<number>(8).fill(0)

/**
 * Uses logical terrain outlines rather than Voronoi collision silhouettes so
 * cell jitter cannot create false ledges. Straight-edged terrain contributes
 * its contour, while painted terrain contributes the union of its grid cells.
 */
export function buildTerrainEdgeProtectionWalls(
  terrain: TerrainDataLike,
  gravityX: number,
  gravityY: number
): TerrainEdgeProtectionWall[] {
  const gravityLengthSq = gravityX * gravityX + gravityY * gravityY
  if (gravityLengthSq <= 0) {
    return []
  }

  const exposedEdges = collectTerrainExposedEdges(terrain)
  const connectedEdges = new Map<string, BoundaryEdge[]>()
  for (const edge of exposedEdges.values()) {
    edge.support = isSupportEdge(edge, gravityX, gravityY, gravityLengthSq)
    appendConnectedEdge(connectedEdges, edge.startKey, edge)
    appendConnectedEdge(connectedEdges, edge.endKey, edge)
  }

  const protectedVertices = new Set<string>()
  const walls: TerrainEdgeProtectionWall[] = []
  for (const edge of exposedEdges.values()) {
    if (!edge.edgeProtection || !edge.support) {
      continue
    }
    appendWallAtFallingEndpoint(
      walls,
      protectedVertices,
      connectedEdges,
      edge,
      edge.startKey,
      edge.startX,
      edge.startY,
      gravityX,
      gravityY,
      gravityLengthSq
    )
    appendWallAtFallingEndpoint(
      walls,
      protectedVertices,
      connectedEdges,
      edge,
      edge.endKey,
      edge.endX,
      edge.endY,
      gravityX,
      gravityY,
      gravityLengthSq
    )
  }
  return walls
}

function collectTerrainExposedEdges(
  terrain: TerrainDataLike
): Map<string, BoundaryEdge> {
  const edges = new Map<string, BoundaryEdge>()
  const layers = getTerrainLayerViews(terrain)
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]
    const renderLayer = layer.materialId
      ? normalizeRenderLayer(
          layer.renderLayer,
          getDefaultTerrainRenderLayer(layer.materialId)
        )
      : normalizeRenderLayer(layer.renderLayer, 0)
    const layerMaterialTag = layer.materialId
      ? getTerrainMaterialTagById(layer.materialId)
      : null
    if (layerMaterialTag === 'foliage') {
      continue
    }
    if (layer.contourClipPoints && layer.contourClipPoints.length >= 6) {
      appendPolygonEdges(
        edges,
        layer.contourClipPoints,
        renderLayer,
        layer.edgeProtection
      )
      continue
    }

    const chunkSize = layer.chunkSize
    const cellSize = layer.cellSize
    for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
      const chunk = layer.chunks[chunkIndex]
      const cells = getTerrainChunkMaterialCodes(chunk)
      const baseCellX = layer.offsetCellX + chunk.chunkX * chunkSize
      const baseCellY = layer.offsetCellY + chunk.chunkY * chunkSize
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const materialCode = cells[cellIndex] | 0
        if (!isSolidTerrainCode(materialCode)) {
          continue
        }
        const materialTag =
          layerMaterialTag ?? getTerrainMaterialTagByCode(materialCode)
        if (!materialTag || materialTag === 'foliage') {
          continue
        }
        const cellX =
          (baseCellX + (cellIndex % chunkSize)) * cellSize + layer.offsetXUnits
        const cellY =
          (baseCellY + Math.floor(cellIndex / chunkSize)) * cellSize +
          layer.offsetYUnits
        cellPoints[0] = cellX
        cellPoints[1] = cellY
        cellPoints[2] = cellX + cellSize
        cellPoints[3] = cellY
        cellPoints[4] = cellX + cellSize
        cellPoints[5] = cellY + cellSize
        cellPoints[6] = cellX
        cellPoints[7] = cellY + cellSize
        appendPolygonEdges(edges, cellPoints, renderLayer, layer.edgeProtection)
      }
    }
  }
  return edges
}

function appendPolygonEdges(
  edges: Map<string, BoundaryEdge>,
  points: readonly number[],
  renderLayer: number,
  edgeProtection: boolean
): void {
  const clockwise = getSignedAreaTwice(points) > 0
  const pointCount = points.length >> 1
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const nextPointIndex = (pointIndex + 1) % pointCount
    const sourceStartX = Math.round(points[pointIndex * 2] * COORDINATE_SCALE)
    const sourceStartY = Math.round(
      points[pointIndex * 2 + 1] * COORDINATE_SCALE
    )
    const sourceEndX = Math.round(points[nextPointIndex * 2] * COORDINATE_SCALE)
    const sourceEndY = Math.round(
      points[nextPointIndex * 2 + 1] * COORDINATE_SCALE
    )
    if (sourceStartX === sourceEndX && sourceStartY === sourceEndY) {
      continue
    }
    const sourceStartKey = buildVertexKey(
      renderLayer,
      sourceStartX,
      sourceStartY
    )
    const sourceEndKey = buildVertexKey(renderLayer, sourceEndX, sourceEndY)
    const edgeKey =
      sourceStartKey < sourceEndKey
        ? `${sourceStartKey}>${sourceEndKey}`
        : `${sourceEndKey}>${sourceStartKey}`
    if (edges.has(edgeKey)) {
      edges.delete(edgeKey)
      continue
    }
    edges.set(edgeKey, {
      startX: clockwise ? sourceStartX : sourceEndX,
      startY: clockwise ? sourceStartY : sourceEndY,
      endX: clockwise ? sourceEndX : sourceStartX,
      endY: clockwise ? sourceEndY : sourceStartY,
      startKey: clockwise ? sourceStartKey : sourceEndKey,
      endKey: clockwise ? sourceEndKey : sourceStartKey,
      renderLayer,
      edgeProtection,
      support: false,
    })
  }
}

function getSignedAreaTwice(points: readonly number[]): number {
  let area = 0
  const pointCount = points.length >> 1
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const nextPointIndex = (pointIndex + 1) % pointCount
    area +=
      points[pointIndex * 2] * points[nextPointIndex * 2 + 1] -
      points[nextPointIndex * 2] * points[pointIndex * 2 + 1]
  }
  return area
}

function buildVertexKey(renderLayer: number, x: number, y: number): string {
  return `${renderLayer}:${x}:${y}`
}

function appendConnectedEdge(
  connectedEdges: Map<string, BoundaryEdge[]>,
  vertexKey: string,
  edge: BoundaryEdge
): void {
  const connected = connectedEdges.get(vertexKey)
  if (connected) {
    connected.push(edge)
  } else {
    connectedEdges.set(vertexKey, [edge])
  }
}

function isSupportEdge(
  edge: BoundaryEdge,
  gravityX: number,
  gravityY: number,
  gravityLengthSq: number
): boolean {
  const tangentX = edge.endX - edge.startX
  const tangentY = edge.endY - edge.startY
  const outwardNormalX = tangentY
  const outwardNormalY = -tangentX
  const oppositeGravityDot = -(
    outwardNormalX * gravityX +
    outwardNormalY * gravityY
  )
  if (oppositeGravityDot <= 0) {
    return false
  }
  const edgeLengthSq = tangentX * tangentX + tangentY * tangentY
  return (
    oppositeGravityDot * oppositeGravityDot * 2 >=
    edgeLengthSq * gravityLengthSq
  )
}

function appendWallAtFallingEndpoint(
  walls: TerrainEdgeProtectionWall[],
  protectedVertices: Set<string>,
  connectedEdges: ReadonlyMap<string, readonly BoundaryEdge[]>,
  supportEdge: BoundaryEdge,
  vertexKey: string,
  vertexX: number,
  vertexY: number,
  gravityX: number,
  gravityY: number,
  gravityLengthSq: number
): void {
  if (protectedVertices.has(vertexKey)) {
    return
  }
  const connected = connectedEdges.get(vertexKey)
  if (!connected) {
    return
  }
  for (let edgeIndex = 0; edgeIndex < connected.length; edgeIndex++) {
    const edge = connected[edgeIndex]
    if (edge === supportEdge || edge.support) {
      continue
    }
    const tangentX =
      edge.startKey === vertexKey ? edge.endX - vertexX : edge.startX - vertexX
    const tangentY =
      edge.startKey === vertexKey ? edge.endY - vertexY : edge.startY - vertexY
    const gravityDot = tangentX * gravityX + tangentY * gravityY
    if (gravityDot <= 0) {
      continue
    }
    const tangentLengthSq = tangentX * tangentX + tangentY * tangentY
    if (gravityDot * gravityDot * 2 < tangentLengthSq * gravityLengthSq) {
      continue
    }
    protectedVertices.add(vertexKey)
    const isStart = supportEdge.startKey === vertexKey
    walls.push({
      x: vertexX / COORDINATE_SCALE,
      y: vertexY / COORDINATE_SCALE,
      interiorX: isStart
        ? supportEdge.endX - supportEdge.startX
        : supportEdge.startX - supportEdge.endX,
      interiorY: isStart
        ? supportEdge.endY - supportEdge.startY
        : supportEdge.startY - supportEdge.endY,
      renderLayer: supportEdge.renderLayer,
    })
    return
  }
}
