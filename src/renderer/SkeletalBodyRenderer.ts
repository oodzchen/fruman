import { Container, Graphics, Sprite, Texture } from 'pixi.js'

import type { BonePart, BoneSegment } from '../editorMapTypes'
import type { BuiltSkeleton } from './SkeletalSpineBuilder'

// pixels per editor-meter in the editor canvas (reference scale)
const EDITOR_PPM = 128

// Cached textures keyed by shapeDataUrl
const textureCache = new Map<string, Texture>()

function getOrCreateTexture(dataUrl: string): Texture {
  const cached = textureCache.get(dataUrl)
  if (cached) return cached
  const tex = Texture.from(dataUrl)
  textureCache.set(dataUrl, tex)
  return tex
}

interface BoneSprite {
  sprite: Sprite | null
  graphics: Graphics | null
  part: BonePart
}

// Per-entity bone display objects
const entityBoneSprites = new Map<number, BoneSprite[]>()

// Graphics pool
const graphicsPool: Graphics[] = []

function acquireGraphics(): Graphics {
  return graphicsPool.pop() ?? new Graphics()
}

function releaseGraphics(g: Graphics): void {
  g.clear()
  g.visible = false
  graphicsPool.push(g)
}

export function renderSkeletalBody(
  entityId: number,
  container: Container,
  built: BuiltSkeleton,
  segments: BoneSegment[] | undefined,
  ppm: number
): void {
  const bones = built.skeleton.bones
  const boneIndex = built.boneIndex

  const displayScale = ppm / EDITOR_PPM

  const visibleBones: Array<{ boneName: string; part: BonePart }> = [
    { boneName: 'body', part: 'body' },
    { boneName: 'head', part: 'head' },
    { boneName: 'upperArm_R', part: 'upperArmR' },
    { boneName: 'forearm_R', part: 'forearmR' },
    { boneName: 'hand_R', part: 'handR' },
    { boneName: 'upperArm_L', part: 'upperArmL' },
    { boneName: 'forearm_L', part: 'forearmL' },
    { boneName: 'hand_L', part: 'handL' },
    { boneName: 'thigh_R', part: 'thighR' },
    { boneName: 'lowerLeg_R', part: 'lowerLegR' },
    { boneName: 'foot_R', part: 'footR' },
    { boneName: 'thigh_L', part: 'thighL' },
    { boneName: 'lowerLeg_L', part: 'lowerLegL' },
    { boneName: 'foot_L', part: 'footL' },
  ]

  let boneSprites = entityBoneSprites.get(entityId)
  if (!boneSprites) {
    boneSprites = []
    entityBoneSprites.set(entityId, boneSprites)
  }

  // Ensure we have enough display objects
  while (boneSprites.length < visibleBones.length) {
    boneSprites.push({ sprite: null, graphics: null, part: 'body' })
  }

  for (let i = 0; i < visibleBones.length; i++) {
    const { boneName, part } = visibleBones[i]
    const boneIdx = boneIndex.get(boneName)
    if (boneIdx === undefined) continue
    const bone = bones[boneIdx]
    const entry = boneSprites[i]
    entry.part = part

    const seg = segments?.find((s) => s.part === part)
    const boneData = built.skeleton.data.bones[boneIdx]
    const worldRot = bone.getWorldRotationX() * (Math.PI / 180)

    if (seg?.shapeDataUrl) {
      if (!entry.sprite) {
        if (entry.graphics) {
          releaseGraphics(entry.graphics)
          entry.graphics = null
        }
        entry.sprite = new Sprite()
        container.addChild(entry.sprite)
      }
      const s = entry.sprite
      s.texture = getOrCreateTexture(seg.shapeDataUrl)
      s.scale.set(displayScale)
      s.position.set(bone.worldX, bone.worldY)
      s.visible = true
      if (
        seg.pivotX !== undefined &&
        seg.pivotY !== undefined &&
        seg.tipX !== undefined &&
        seg.tipY !== undefined &&
        seg.shapeOffsetX !== undefined &&
        seg.shapeOffsetY !== undefined
      ) {
        // Rotation: worldRot is the bone's runtime angle; editorAngle is the
        // angle the bone had when the shape was drawn. The difference corrects
        // for the fact that the texture was painted in editor canvas orientation.
        const editorDx = seg.tipX - seg.pivotX
        const editorDy = seg.tipY - seg.pivotY
        const editorAngle =
          editorDx === 0 && editorDy === 0 ? 0 : Math.atan2(editorDy, editorDx)
        s.rotation = worldRot - editorAngle
        s.pivot.set(
          seg.pivotX - seg.shapeOffsetX,
          seg.pivotY - seg.shapeOffsetY
        )
      } else {
        s.rotation = worldRot
        s.pivot.set(0, 0)
      }
    } else {
      // Fallback: colored rectangle
      if (entry.sprite) {
        entry.sprite.visible = false
      }
      if (!entry.graphics) {
        entry.graphics = acquireGraphics()
        container.addChild(entry.graphics)
      }
      const g = entry.graphics
      g.clear()

      const lengthPx = boneData.length
      const widthPx = (seg?.width ?? 0.06) * ppm
      const halfW = widthPx * 0.5

      g.roundRect(0, -halfW, lengthPx, widthPx, halfW * 0.3)
      g.fill({ color: getPartColor(part), alpha: 1 })

      g.rotation = worldRot
      g.position.set(bone.worldX, bone.worldY)
      g.visible = true
    }
  }
}

export function releaseSkeletalBody(entityId: number): void {
  const sprites = entityBoneSprites.get(entityId)
  if (!sprites) return
  for (const entry of sprites) {
    if (entry.sprite) {
      entry.sprite.parent?.removeChild(entry.sprite)
      entry.sprite.destroy()
      entry.sprite = null
    }
    if (entry.graphics) {
      entry.graphics.parent?.removeChild(entry.graphics)
      releaseGraphics(entry.graphics)
      entry.graphics = null
    }
  }
  entityBoneSprites.delete(entityId)
}

export function hideSkeletalBody(entityId: number): void {
  const sprites = entityBoneSprites.get(entityId)
  if (!sprites) return
  for (const entry of sprites) {
    if (entry.sprite) entry.sprite.visible = false
    if (entry.graphics) entry.graphics.visible = false
  }
}

function getPartColor(part: BonePart): number {
  switch (part) {
    case 'body':
      return 0x888888
    case 'head':
      return 0xaaaaaa
    case 'upperArmR':
    case 'forearmR':
    case 'handR':
    case 'upperArmL':
    case 'forearmL':
    case 'handL':
      return 0x777777
    case 'thighR':
    case 'lowerLegR':
    case 'footR':
    case 'thighL':
    case 'lowerLegL':
    case 'footL':
      return 0x666666
  }
}
