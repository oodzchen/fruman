import * as fabric from 'fabric'

import type { EditorObjectData } from './types'

const SNAP_ENTER_THRESHOLD_PX = 10
const SNAP_EXIT_THRESHOLD_PX = 14
const SNAP_GUIDE_COLOR = 'rgba(240, 220, 180, 0.75)'
const SNAP_EVERY_N_FRAMES = 1
const SNAP_ANGLE_THRESHOLD_DEG = 8

const SNAP_ANCHOR_LEFT = 0
const SNAP_ANCHOR_RIGHT = 1

interface SnapBounds {
  minAxis: number
  maxAxis: number
  minPerp: number
  maxPerp: number
  centerAxis: number
  centerPerp: number
}

interface EditorSnapManagerContext {
  fabricCanvas: () => fabric.Canvas | null
  editorObjects: () => EditorObjectData[]
  editorObjectMap: WeakMap<fabric.Object, EditorObjectData>

  updateGroundPatternTransform?: (object: fabric.Object) => void
  updateObstaclePatternTransform?: (object: fabric.Object) => void
  syncCameraIcon?: (object: fabric.Object) => void
  isCameraFrame?: (object: fabric.Object) => boolean
  cameraViewMap?: WeakMap<fabric.Object, unknown>
}

export class EditorSnapManager {
  private readonly context: EditorSnapManagerContext

  private snapGuideVertical: fabric.Line | null = null
  private snapGuideHorizontal: fabric.Line | null = null
  private snapCandidateObjects: fabric.Object[] = []

  private snapBoundsScratchA: SnapBounds = {
    minAxis: 0,
    maxAxis: 0,
    minPerp: 0,
    maxPerp: 0,
    centerAxis: 0,
    centerPerp: 0,
  }

  private snapBoundsScratchB: SnapBounds = {
    minAxis: 0,
    maxAxis: 0,
    minPerp: 0,
    maxPerp: 0,
    centerAxis: 0,
    centerPerp: 0,
  }

  private snapActiveTarget: fabric.Object | null = null
  private snapFrameCounter = 0
  private snapLockXActive = false
  private snapLockYActive = false
  private snapLockXAnchor = SNAP_ANCHOR_LEFT
  private snapLockYAnchor = SNAP_ANCHOR_LEFT
  private snapLockXValue = 0
  private snapLockYValue = 0
  private snapLockXGuide = false
  private snapLockYGuide = false

  constructor(context: EditorSnapManagerContext) {
    this.context = context
  }

  private isStraightEdgeShape(object: fabric.Object): boolean {
    return object.type === 'rect' || object.type === 'polygon'
  }

  private resetSnapState() {
    this.hideSnapGuides()
    this.clearSnapCandidates()
  }

  private normalizeAngleDeg(angle: number): number {
    let value = Math.round(angle) % 180
    if (value < 0) {
      value += 180
    }
    return value
  }

  private isAngleAligned(a: number, b: number): boolean {
    const angleA = this.normalizeAngleDeg(a)
    const angleB = this.normalizeAngleDeg(b)
    let delta = Math.abs(angleA - angleB)
    if (delta > 90) {
      delta = 180 - delta
    }
    return delta <= SNAP_ANGLE_THRESHOLD_DEG
  }

  private updateProjectedBoundsFromObject(
    object: fabric.Object,
    axisX: number,
    axisY: number,
    out: SnapBounds
  ): boolean {
    const coords = object.aCoords
    if (!coords) {
      return false
    }
    const perpX = -axisY
    const perpY = axisX

    const tl = coords.tl
    let axis = tl.x * axisX + tl.y * axisY
    let perp = tl.x * perpX + tl.y * perpY

    let minAxis = axis
    let maxAxis = axis
    let minPerp = perp
    let maxPerp = perp

    const tr = coords.tr
    axis = tr.x * axisX + tr.y * axisY
    perp = tr.x * perpX + tr.y * perpY
    if (axis < minAxis) minAxis = axis
    if (axis > maxAxis) maxAxis = axis
    if (perp < minPerp) minPerp = perp
    if (perp > maxPerp) maxPerp = perp

    const br = coords.br
    axis = br.x * axisX + br.y * axisY
    perp = br.x * perpX + br.y * perpY
    if (axis < minAxis) minAxis = axis
    if (axis > maxAxis) maxAxis = axis
    if (perp < minPerp) minPerp = perp
    if (perp > maxPerp) maxPerp = perp

    const bl = coords.bl
    axis = bl.x * axisX + bl.y * axisY
    perp = bl.x * perpX + bl.y * perpY
    if (axis < minAxis) minAxis = axis
    if (axis > maxAxis) maxAxis = axis
    if (perp < minPerp) minPerp = perp
    if (perp > maxPerp) maxPerp = perp

    out.minAxis = minAxis
    out.maxAxis = maxAxis
    out.minPerp = minPerp
    out.maxPerp = maxPerp
    out.centerAxis = (minAxis + maxAxis) * 0.5
    out.centerPerp = (minPerp + maxPerp) * 0.5
    return true
  }

  ensureSnapGuides(): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas || (this.snapGuideVertical && this.snapGuideHorizontal)) {
      return
    }

    const width = canvas.getWidth()
    const height = canvas.getHeight()
    const baseOptions: ConstructorParameters<typeof fabric.Line>[1] = {
      stroke: SNAP_GUIDE_COLOR,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
      visible: false,
    }

    if (!this.snapGuideVertical) {
      this.snapGuideVertical = new fabric.Line([0, 0, 0, height], baseOptions)
      canvas.add(this.snapGuideVertical)
    }
    if (!this.snapGuideHorizontal) {
      this.snapGuideHorizontal = new fabric.Line([0, 0, width, 0], baseOptions)
      canvas.add(this.snapGuideHorizontal)
    }

    canvas.bringObjectToFront(this.snapGuideVertical)
    canvas.bringObjectToFront(this.snapGuideHorizontal)
  }

  hideSnapGuides(): void {
    if (this.snapGuideVertical && this.snapGuideVertical.visible) {
      this.snapGuideVertical.visible = false
    }
    if (this.snapGuideHorizontal && this.snapGuideHorizontal.visible) {
      this.snapGuideHorizontal.visible = false
    }
    this.context.fabricCanvas()?.requestRenderAll()
  }

  handleObjectMoving(target: fabric.Object): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
      return
    }

    const targetData = this.context.editorObjectMap.get(target)
    if (
      !targetData ||
      (targetData.type !== 'ground' && targetData.type !== 'obstacle') ||
      !this.isStraightEdgeShape(target)
    ) {
      if (this.snapActiveTarget) {
        this.resetSnapState()
      }
      return
    }

    this.ensureSnapGuides()

    if (this.snapActiveTarget !== target) {
      this.prepareSnapCandidates(target)
    }

    this.snapFrameCounter += 1

    if (this.snapFrameCounter % SNAP_EVERY_N_FRAMES !== 0) {
      if (this.context.updateGroundPatternTransform) {
        this.context.updateGroundPatternTransform(target)
      }
      if (this.context.updateObstaclePatternTransform) {
        this.context.updateObstaclePatternTransform(target)
      }
      if (this.context.isCameraFrame?.(target)) {
        const cameraViewMap = this.context.cameraViewMap
        const syncCameraIcon = this.context.syncCameraIcon
        if (cameraViewMap && syncCameraIcon) {
          const data = cameraViewMap.get(target)
          if (data) {
            syncCameraIcon(target)
          }
        }
      }
      return
    }

    target.setCoords()
    const targetBounds = this.snapBoundsScratchA
    const angleDeg = target.angle ?? 0
    const angleRad = (angleDeg * Math.PI) / 180
    const axisX = Math.cos(angleRad)
    const axisY = Math.sin(angleRad)
    const perpX = -axisY
    const perpY = axisX
    if (
      !this.updateProjectedBoundsFromObject(target, axisX, axisY, targetBounds)
    ) {
      return
    }

    let bestDx = 0
    let bestDy = 0
    let bestAbsDx = SNAP_ENTER_THRESHOLD_PX + 1
    let bestAbsDy = SNAP_ENTER_THRESHOLD_PX + 1
    let guideX: number | null = null
    let guideY: number | null = null
    let bestAnchorX = SNAP_ANCHOR_LEFT
    let bestAnchorY = SNAP_ANCHOR_LEFT
    let bestValueX = 0
    let bestValueY = 0
    let bestGuideX = false
    let bestGuideY = false
    let bestEdgeAbsDx = SNAP_ENTER_THRESHOLD_PX + 1
    let bestEdgeAbsDy = SNAP_ENTER_THRESHOLD_PX + 1
    let bestEdgeDx = 0
    let bestEdgeDy = 0
    let bestEdgeAnchorX = SNAP_ANCHOR_LEFT
    let bestEdgeAnchorY = SNAP_ANCHOR_LEFT
    let bestEdgeValueX = 0
    let bestEdgeValueY = 0

    if (this.snapLockXActive) {
      const anchorX =
        this.snapLockXAnchor === SNAP_ANCHOR_LEFT
          ? targetBounds.minAxis
          : this.snapLockXAnchor === SNAP_ANCHOR_RIGHT
            ? targetBounds.maxAxis
            : targetBounds.centerAxis
      const dx = this.snapLockXValue - anchorX
      const absDx = Math.abs(dx)
      if (absDx <= SNAP_EXIT_THRESHOLD_PX) {
        bestDx = dx
        bestAbsDx = absDx
        guideX = this.snapLockXGuide ? this.snapLockXValue : null
      } else {
        this.snapLockXActive = false
      }
    }

    if (this.snapLockYActive) {
      const anchorY =
        this.snapLockYAnchor === SNAP_ANCHOR_LEFT
          ? targetBounds.minPerp
          : this.snapLockYAnchor === SNAP_ANCHOR_RIGHT
            ? targetBounds.maxPerp
            : targetBounds.centerPerp
      const dy = this.snapLockYValue - anchorY
      const absDy = Math.abs(dy)
      if (absDy <= SNAP_EXIT_THRESHOLD_PX) {
        bestDy = dy
        bestAbsDy = absDy
        guideY = this.snapLockYGuide ? this.snapLockYValue : null
      } else {
        this.snapLockYActive = false
      }
    }

    const candidates = this.snapCandidateObjects

    if (!this.snapLockXActive || !this.snapLockYActive) {
      for (let i = 0; i < candidates.length; i++) {
        const other = candidates[i]
        if (
          !this.updateProjectedBoundsFromObject(
            other,
            axisX,
            axisY,
            this.snapBoundsScratchB
          )
        ) {
          continue
        }
        const otherBounds = this.snapBoundsScratchB
        const axisOverlap =
          otherBounds.maxAxis + SNAP_ENTER_THRESHOLD_PX >=
            targetBounds.minAxis &&
          otherBounds.minAxis - SNAP_ENTER_THRESHOLD_PX <= targetBounds.maxAxis
        const perpOverlap =
          otherBounds.maxPerp + SNAP_ENTER_THRESHOLD_PX >=
            targetBounds.minPerp &&
          otherBounds.minPerp - SNAP_ENTER_THRESHOLD_PX <= targetBounds.maxPerp

        if ((!this.snapLockXActive || this.snapLockXGuide) && perpOverlap) {
          const dxLL = otherBounds.minAxis - targetBounds.minAxis
          const absDxLL = Math.abs(dxLL)
          if (absDxLL < bestEdgeAbsDx && absDxLL <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDx = absDxLL
            bestEdgeDx = dxLL
            bestEdgeAnchorX = SNAP_ANCHOR_LEFT
            bestEdgeValueX = otherBounds.minAxis
          }
          const dxLR = otherBounds.minAxis - targetBounds.maxAxis
          const absDxLR = Math.abs(dxLR)
          if (absDxLR < bestEdgeAbsDx && absDxLR <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDx = absDxLR
            bestEdgeDx = dxLR
            bestEdgeAnchorX = SNAP_ANCHOR_RIGHT
            bestEdgeValueX = otherBounds.minAxis
          }
          const dxRL = otherBounds.maxAxis - targetBounds.minAxis
          const absDxRL = Math.abs(dxRL)
          if (absDxRL < bestEdgeAbsDx && absDxRL <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDx = absDxRL
            bestEdgeDx = dxRL
            bestEdgeAnchorX = SNAP_ANCHOR_LEFT
            bestEdgeValueX = otherBounds.maxAxis
          }
          const dxRR = otherBounds.maxAxis - targetBounds.maxAxis
          const absDxRR = Math.abs(dxRR)
          if (absDxRR < bestEdgeAbsDx && absDxRR <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDx = absDxRR
            bestEdgeDx = dxRR
            bestEdgeAnchorX = SNAP_ANCHOR_RIGHT
            bestEdgeValueX = otherBounds.maxAxis
          }
          // center snap disabled
        }

        if ((!this.snapLockYActive || this.snapLockYGuide) && axisOverlap) {
          const dyTT = otherBounds.minPerp - targetBounds.minPerp
          const absDyTT = Math.abs(dyTT)
          if (absDyTT < bestEdgeAbsDy && absDyTT <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDy = absDyTT
            bestEdgeDy = dyTT
            bestEdgeAnchorY = SNAP_ANCHOR_LEFT
            bestEdgeValueY = otherBounds.minPerp
          }
          const dyTB = otherBounds.minPerp - targetBounds.maxPerp
          const absDyTB = Math.abs(dyTB)
          if (absDyTB < bestEdgeAbsDy && absDyTB <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDy = absDyTB
            bestEdgeDy = dyTB
            bestEdgeAnchorY = SNAP_ANCHOR_RIGHT
            bestEdgeValueY = otherBounds.minPerp
          }
          const dyBT = otherBounds.maxPerp - targetBounds.minPerp
          const absDyBT = Math.abs(dyBT)
          if (absDyBT < bestEdgeAbsDy && absDyBT <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDy = absDyBT
            bestEdgeDy = dyBT
            bestEdgeAnchorY = SNAP_ANCHOR_LEFT
            bestEdgeValueY = otherBounds.maxPerp
          }
          const dyBB = otherBounds.maxPerp - targetBounds.maxPerp
          const absDyBB = Math.abs(dyBB)
          if (absDyBB < bestEdgeAbsDy && absDyBB <= SNAP_ENTER_THRESHOLD_PX) {
            bestEdgeAbsDy = absDyBB
            bestEdgeDy = dyBB
            bestEdgeAnchorY = SNAP_ANCHOR_RIGHT
            bestEdgeValueY = otherBounds.maxPerp
          }
          // center snap disabled
        }
      }
    }

    if (!this.snapLockXActive) {
      if (bestEdgeAbsDx <= SNAP_ENTER_THRESHOLD_PX) {
        bestAbsDx = bestEdgeAbsDx
        bestDx = bestEdgeDx
        guideX = null
        bestAnchorX = bestEdgeAnchorX
        bestValueX = bestEdgeValueX
        bestGuideX = false
      }
    }

    if (!this.snapLockYActive) {
      if (bestEdgeAbsDy <= SNAP_ENTER_THRESHOLD_PX) {
        bestAbsDy = bestEdgeAbsDy
        bestDy = bestEdgeDy
        guideY = null
        bestAnchorY = bestEdgeAnchorY
        bestValueY = bestEdgeValueY
        bestGuideY = false
      }
    }

    if (
      bestAbsDx <= SNAP_ENTER_THRESHOLD_PX ||
      bestAbsDy <= SNAP_ENTER_THRESHOLD_PX ||
      this.snapLockXActive ||
      this.snapLockYActive
    ) {
      const moveX = axisX * bestDx + perpX * bestDy
      const moveY = axisY * bestDx + perpY * bestDy
      target.set({
        left: (target.left ?? 0) + moveX,
        top: (target.top ?? 0) + moveY,
      })
      target.setCoords()
    }

    if (!this.snapLockXActive && bestAbsDx <= SNAP_ENTER_THRESHOLD_PX) {
      this.snapLockXActive = true
      this.snapLockXAnchor = bestAnchorX
      this.snapLockXValue = bestValueX
      this.snapLockXGuide = bestGuideX
    }
    if (!this.snapLockYActive && bestAbsDy <= SNAP_ENTER_THRESHOLD_PX) {
      this.snapLockYActive = true
      this.snapLockYAnchor = bestAnchorY
      this.snapLockYValue = bestValueY
      this.snapLockYGuide = bestGuideY
    }

    const angleNorm = this.normalizeAngleDeg(angleDeg)
    if (angleNorm !== 0 && angleNorm !== 90) {
      guideX = null
      guideY = null
    }

    if (guideX !== null) {
      this.updateSnapGuideVertical(guideX)
    } else if (this.snapGuideVertical) {
      this.snapGuideVertical.visible = false
    }
    if (guideY !== null) {
      this.updateSnapGuideHorizontal(guideY)
    } else if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.visible = false
    }

    if (this.context.updateGroundPatternTransform) {
      this.context.updateGroundPatternTransform(target)
    }
    if (this.context.updateObstaclePatternTransform) {
      this.context.updateObstaclePatternTransform(target)
    }
    if (this.context.isCameraFrame?.(target)) {
      const cameraViewMap = this.context.cameraViewMap
      const syncCameraIcon = this.context.syncCameraIcon
      if (cameraViewMap && syncCameraIcon) {
        const data = cameraViewMap.get(target)
        if (data) {
          syncCameraIcon(target)
        }
      }
    }

    canvas.requestRenderAll()
  }

  prepareSnapCandidates(target: fabric.Object): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
      return
    }

    this.clearSnapCandidates()
    this.snapActiveTarget = target
    const targetAngle = target.angle ?? 0

    const editorObjects = this.context.editorObjects()
    for (let i = 0; i < editorObjects.length; i++) {
      const data = editorObjects[i]
      if (
        (data.type !== 'ground' && data.type !== 'obstacle') ||
        !this.isStraightEdgeShape(data.object)
      ) {
        continue
      }
      const other = data.object
      if (other === target || other.canvas !== canvas) {
        continue
      }
      if (!this.isAngleAligned(targetAngle, other.angle ?? 0)) {
        continue
      }
      other.setCoords()
      this.snapCandidateObjects.push(other)
    }
  }

  clearSnapCandidates(): void {
    this.snapCandidateObjects.length = 0
    this.snapActiveTarget = null
    this.snapFrameCounter = 0
    this.snapLockXActive = false
    this.snapLockYActive = false
    this.snapLockXGuide = false
    this.snapLockYGuide = false
  }

  resizeSnapGuides(): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
      return
    }

    const width = canvas.getWidth()
    const height = canvas.getHeight()

    if (this.snapGuideVertical) {
      this.snapGuideVertical.set({
        x1: this.snapGuideVertical.x1,
        x2: this.snapGuideVertical.x2,
        y1: 0,
        y2: height,
      })
      this.snapGuideVertical.setCoords()
    }
    if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.set({
        x1: 0,
        x2: width,
        y1: this.snapGuideHorizontal.y1,
        y2: this.snapGuideHorizontal.y2,
      })
      this.snapGuideHorizontal.setCoords()
    }
  }

  private updateSnapGuideVertical(x: number): void {
    const canvas = this.context.fabricCanvas()
    if (!this.snapGuideVertical || !canvas) {
      return
    }

    const height = canvas.getHeight()
    this.snapGuideVertical.set({
      x1: x,
      y1: 0,
      x2: x,
      y2: height,
      visible: true,
    })
    this.snapGuideVertical.setCoords()
    canvas.bringObjectToFront(this.snapGuideVertical)
  }

  private updateSnapGuideHorizontal(y: number): void {
    const canvas = this.context.fabricCanvas()
    if (!this.snapGuideHorizontal || !canvas) {
      return
    }

    const width = canvas.getWidth()
    this.snapGuideHorizontal.set({
      x1: 0,
      y1: y,
      x2: width,
      y2: y,
      visible: true,
    })
    this.snapGuideHorizontal.setCoords()
    canvas.bringObjectToFront(this.snapGuideHorizontal)
  }

  // Bounds are computed per-frame in handleObjectMoving to avoid extra allocations.
}
