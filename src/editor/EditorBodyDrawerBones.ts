import type { BonePart } from '../editorMapTypes'
import { createLayerCanvas } from './EditorBodyDrawerCanvas'
import type { EditorBodyLayer } from './EditorBodyDrawerTypes'

export interface BoneHierarchyNode {
  part: BonePart
  label: string
  children?: BoneHierarchyNode[]
}

export interface BoneDefaultPosition {
  pivotX: number
  pivotY: number
  tipX: number
  tipY: number
}

export const BONE_PARTS_ORDERED: readonly BonePart[] = [
  'body',
  'head',
  'upperArmR',
  'forearmR',
  'handR',
  'upperArmL',
  'forearmL',
  'handL',
  'thighR',
  'lowerLegR',
  'footR',
  'thighL',
  'lowerLegL',
  'footL',
]

export const BONE_HIERARCHY: readonly BoneHierarchyNode[] = [
  {
    part: 'body',
    label: '身体',
    children: [
      { part: 'head', label: '头部' },
      {
        part: 'upperArmR',
        label: '右上臂',
        children: [
          {
            part: 'forearmR',
            label: '右小臂',
            children: [{ part: 'handR', label: '右手掌' }],
          },
        ],
      },
      {
        part: 'upperArmL',
        label: '左上臂',
        children: [
          {
            part: 'forearmL',
            label: '左小臂',
            children: [{ part: 'handL', label: '左手掌' }],
          },
        ],
      },
      {
        part: 'thighR',
        label: '右大腿',
        children: [
          {
            part: 'lowerLegR',
            label: '右小腿',
            children: [{ part: 'footR', label: '右脚掌' }],
          },
        ],
      },
      {
        part: 'thighL',
        label: '左大腿',
        children: [
          {
            part: 'lowerLegL',
            label: '左小腿',
            children: [{ part: 'footL', label: '左脚掌' }],
          },
        ],
      },
    ],
  },
]

// Pixel positions in the 960x960 edit canvas, matching the 320x320 viewport.
export const BONE_DEFAULT_POSITIONS: Record<BonePart, BoneDefaultPosition> = {
  body: { pivotX: 480, pivotY: 474, tipX: 480, tipY: 376 },
  head: { pivotX: 480, pivotY: 376, tipX: 480, tipY: 340 },
  upperArmR: { pivotX: 508, pivotY: 384, tipX: 548, tipY: 422 },
  forearmR: { pivotX: 548, pivotY: 422, tipX: 578, tipY: 456 },
  handR: { pivotX: 578, pivotY: 456, tipX: 592, tipY: 472 },
  upperArmL: { pivotX: 452, pivotY: 384, tipX: 412, tipY: 422 },
  forearmL: { pivotX: 412, pivotY: 422, tipX: 382, tipY: 456 },
  handL: { pivotX: 382, pivotY: 456, tipX: 368, tipY: 472 },
  thighR: { pivotX: 495, pivotY: 468, tipX: 495, tipY: 542 },
  lowerLegR: { pivotX: 495, pivotY: 542, tipX: 495, tipY: 600 },
  footR: { pivotX: 495, pivotY: 600, tipX: 518, tipY: 614 },
  thighL: { pivotX: 465, pivotY: 468, tipX: 465, tipY: 542 },
  lowerLegL: { pivotX: 465, pivotY: 542, tipX: 465, tipY: 600 },
  footL: { pivotX: 465, pivotY: 600, tipX: 442, tipY: 614 },
}

const BONE_BASE_LAYER_ID = 100

export function getBoneLayerId(part: BonePart): number {
  return BONE_BASE_LAYER_ID + BONE_PARTS_ORDERED.indexOf(part)
}

export function createBoneLayer(part: BonePart): EditorBodyLayer {
  const { canvas, ctx } = createLayerCanvas()
  const def = BONE_DEFAULT_POSITIONS[part]
  return {
    id: getBoneLayerId(part),
    name: part,
    kind: 'bone',
    canvas,
    ctx,
    bounds: null,
    boundsDirty: false,
    bonePart: part,
    bonePivotX: def.pivotX,
    bonePivotY: def.pivotY,
    boneTipX: def.tipX,
    boneTipY: def.tipY,
  }
}

export function findBoneLayer(
  layers: readonly EditorBodyLayer[],
  part: BonePart
): EditorBodyLayer | null {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].bonePart === part) {
      return layers[i]
    }
  }
  return null
}
