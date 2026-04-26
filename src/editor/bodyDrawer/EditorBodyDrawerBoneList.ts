import type { BonePart } from '../../editorMapTypes'
import { BONE_HIERARCHY, type BoneHierarchyNode } from './EditorBodyDrawerBones'
import { clearElementChildren } from './EditorBodyDrawerDom'

export interface EditorBodyDrawerBoneListState {
  container: HTMLDivElement
  collapsedBonePartsSet: Set<BonePart>
  selectedBonePart: BonePart | null
  selectedShapePart: BonePart | null
  selectedBoundaryPart: BonePart | null
}

export interface EditorBodyDrawerBoneListCallbacks {
  onToggleBonePart: (part: BonePart, open: boolean) => void
  onSelectBone: (part: BonePart) => void
  onSelectShape: (part: BonePart) => void
  onSelectBoundary: (part: BonePart) => void
}

export function renderEditorBodyDrawerBoneList(
  state: EditorBodyDrawerBoneListState,
  callbacks: EditorBodyDrawerBoneListCallbacks
) {
  clearElementChildren(state.container)
  for (const node of BONE_HIERARCHY) {
    renderBoneNode(node, state, callbacks, state.container)
  }
}

function renderBoneNode(
  node: BoneHierarchyNode,
  state: EditorBodyDrawerBoneListState,
  callbacks: EditorBodyDrawerBoneListCallbacks,
  container: HTMLElement
) {
  const { part, label, children = [] } = node
  const isBoneActive = state.selectedBonePart === part
  const isParentOfSelected =
    state.selectedShapePart === part || state.selectedBoundaryPart === part

  const details = document.createElement('details')
  details.className = 'editor-object-group'
  details.open = !state.collapsedBonePartsSet.has(part)
  details.addEventListener('toggle', () => {
    callbacks.onToggleBonePart(part, details.open)
  })

  const summary = document.createElement('summary')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'editor-object-toggle'
  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    details.open = !details.open
  })
  summary.appendChild(toggle)

  const boneBtn = document.createElement('button')
  boneBtn.type = 'button'
  boneBtn.style.cssText = getBoneRowStyle(isBoneActive, isParentOfSelected)
  boneBtn.textContent = label
  boneBtn.addEventListener('click', (event) => {
    event.preventDefault()
    callbacks.onSelectBone(part)
  })
  summary.appendChild(boneBtn)
  details.appendChild(summary)

  const childrenEl = document.createElement('div')
  childrenEl.className = 'editor-object-children'
  childrenEl.appendChild(
    createBoneSubRow('shape', part, state.selectedShapePart === part, callbacks)
  )
  childrenEl.appendChild(
    createBoneSubRow(
      'boundary',
      part,
      state.selectedBoundaryPart === part,
      callbacks
    )
  )
  for (const child of children) {
    renderBoneNode(child, state, callbacks, childrenEl)
  }
  details.appendChild(childrenEl)
  container.appendChild(details)
}

function createBoneSubRow(
  kind: 'shape' | 'boundary',
  part: BonePart,
  active: boolean,
  callbacks: EditorBodyDrawerBoneListCallbacks
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.style.cssText = getBoneSubRowStyle(active, kind === 'boundary')
  btn.textContent = `◦ ${kind === 'shape' ? '形状' : '边界'}`
  btn.addEventListener('click', () => {
    if (kind === 'shape') {
      callbacks.onSelectShape(part)
    } else {
      callbacks.onSelectBoundary(part)
    }
  })
  return btn
}

function getBoneRowStyle(active: boolean, parentOfSelected: boolean): string {
  return [
    'flex:1',
    'min-width:0',
    'padding:2px 4px',
    'text-align:left',
    'font-size:10px',
    'font-family:monospace',
    'cursor:pointer',
    'border-radius:2px',
    'box-sizing:border-box',
    'color:rgba(255,255,255,0.88)',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    active
      ? 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3)'
      : parentOfSelected
        ? 'background:rgba(255,255,255,0.06);border:1px dashed rgba(255,255,255,0.35)'
        : 'background:transparent;border:1px solid transparent',
  ].join(';')
}

function getBoneSubRowStyle(active: boolean, boundary: boolean): string {
  return [
    'width:100%',
    'padding:2px 4px',
    'text-align:left',
    'font-size:9px',
    'font-family:monospace',
    'cursor:pointer',
    'border-radius:2px',
    'box-sizing:border-box',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    boundary ? 'color:rgba(255,180,100,0.72)' : 'color:rgba(255,255,255,0.5)',
    active
      ? 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3)'
      : 'background:rgba(255,255,255,0.03);border:1px solid transparent',
  ].join(';')
}
