import { localizer } from '../Localizer'
import { clearElementChildren } from './EditorBodyDrawerDom'
import type { BodyDrawMode, EditorBodyLayer } from './EditorBodyDrawerTypes'

export interface EditorBodyDrawerLayerListState {
  container: HTMLDivElement
  layers: readonly EditorBodyLayer[]
  mode: BodyDrawMode
  selectedLayerId: number
  renamingLayerId: number
}

export interface EditorBodyDrawerLayerListCallbacks {
  onSelectCollision: () => void
  onSelectLayer: (layer: EditorBodyLayer) => void
  onOpenLayerMenu: (event: MouseEvent, layer: EditorBodyLayer) => void
  onCommitRename: (layerId: number, value: string) => void
  onCancelRename: () => void
  onDragStart: (layerId: number, row: HTMLDivElement, event: DragEvent) => void
  onDragOver: (layerId: number, row: HTMLDivElement, event: DragEvent) => void
  onDragEnd: (row: HTMLDivElement) => void
}

export interface EditorBodyDrawerLayerDropPreview {
  layerId: number
  insertAfter: boolean
}

export function renderEditorBodyDrawerLayerList(
  state: EditorBodyDrawerLayerListState,
  callbacks: EditorBodyDrawerLayerListCallbacks
) {
  const { container, layers, mode, selectedLayerId, renamingLayerId } = state
  clearElementChildren(container)

  const collisionRow = createLayerRow(mode === 'collision')
  collisionRow.textContent = localizer.t('editor_body_drawer_layer_collision')
  collisionRow.addEventListener('click', callbacks.onSelectCollision)
  container.appendChild(collisionRow)

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer.kind === 'bone') continue

    const active = mode !== 'collision' && layer.id === selectedLayerId
    const row = createLayerRow(active)
    row.draggable = true
    row.dataset.layerId = String(layer.id)

    if (renamingLayerId === layer.id) {
      appendRenameInput(row, layer, callbacks)
      container.appendChild(row)
      continue
    }

    row.textContent = layer.name
    row.addEventListener('click', () => callbacks.onSelectLayer(layer))
    row.addEventListener('contextmenu', (event) => {
      callbacks.onOpenLayerMenu(event, layer)
    })
    row.addEventListener('dragstart', (event) => {
      callbacks.onDragStart(layer.id, row, event)
    })
    row.addEventListener('dragover', (event) => {
      callbacks.onDragOver(layer.id, row, event)
    })
    row.addEventListener('dragend', () => {
      callbacks.onDragEnd(row)
    })
    container.appendChild(row)
  }
}

export function focusEditorBodyDrawerLayerRename(
  container: HTMLElement,
  layerId: number
) {
  const input = container.querySelector(
    `input[data-layer-rename-id="${layerId}"]`
  )
  if (input instanceof HTMLInputElement) {
    input.focus()
    input.select()
  }
}

export function getEditorBodyDrawerLayerDropPreview(
  container: HTMLElement,
  event: DragEvent
): EditorBodyDrawerLayerDropPreview | null {
  const target = event.target as HTMLElement | null
  const row = target?.closest<HTMLDivElement>('.editor-body-layer-row')
  if (row && row.dataset.layerId) {
    const layerId = Number.parseInt(row.dataset.layerId, 10)
    if (!Number.isFinite(layerId) || layerId < 0) {
      return null
    }
    const rect = row.getBoundingClientRect()
    return {
      layerId,
      insertAfter: event.clientY >= rect.top + rect.height * 0.5,
    }
  }

  const rows = Array.from(
    container.querySelectorAll<HTMLDivElement>('.editor-body-layer-row')
  )
  if (rows.length === 0) {
    return null
  }

  const firstRect = rows[0].getBoundingClientRect()
  const lastRect = rows[rows.length - 1].getBoundingClientRect()
  const firstId = Number.parseInt(rows[0].dataset.layerId || '-1', 10)
  const lastId = Number.parseInt(
    rows[rows.length - 1].dataset.layerId || '-1',
    10
  )
  if (event.clientY < firstRect.top + firstRect.height && firstId >= 0) {
    return { layerId: firstId, insertAfter: false }
  }
  if (event.clientY > lastRect.top && lastId >= 0) {
    return { layerId: lastId, insertAfter: true }
  }
  return null
}

export function setEditorBodyDrawerLayerDropPreviewStyle(
  container: HTMLElement,
  layerId: number,
  insertAfter: boolean
) {
  const row = container.querySelector<HTMLDivElement>(
    `.editor-body-layer-row[data-layer-id="${layerId}"]`
  )
  if (!row) {
    return
  }
  row.style.boxShadow = insertAfter
    ? 'inset 0 -2px 0 rgba(255,255,255,0.82)'
    : 'inset 0 2px 0 rgba(255,255,255,0.82)'
}

export function clearEditorBodyDrawerLayerDropPreviewStyle(
  container: HTMLElement,
  layerId: number
) {
  const row = container.querySelector<HTMLDivElement>(
    `.editor-body-layer-row[data-layer-id="${layerId}"]`
  )
  if (row) {
    row.style.boxShadow = ''
  }
}

function createLayerRow(active: boolean): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'editor-body-layer-row'
  row.style.cssText = [
    'width:100%',
    'padding:6px 6px',
    active
      ? 'background:rgba(255,255,255,0.18)'
      : 'background:rgba(255,255,255,0.08)',
    active
      ? 'border:1px solid rgba(255,255,255,0.4)'
      : 'border:1px solid rgba(255,255,255,0.18)',
    'color:rgba(255,255,255,0.9)',
    'font-family:monospace',
    'font-size:10px',
    'line-height:1.2',
    'text-align:left',
    'word-break:break-all',
    'cursor:pointer',
    'box-sizing:border-box',
  ].join(';')
  return row
}

function appendRenameInput(
  row: HTMLDivElement,
  layer: EditorBodyLayer,
  callbacks: EditorBodyDrawerLayerListCallbacks
) {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = layer.name
  input.dataset.layerRename = '1'
  input.dataset.layerRenameId = String(layer.id)
  input.style.cssText = [
    'width:100%',
    'padding:0',
    'margin:0',
    'background:transparent',
    'border:none',
    'outline:none',
    'color:rgba(255,255,255,0.95)',
    'font-family:monospace',
    'font-size:10px',
    'line-height:1.2',
    'box-sizing:border-box',
  ].join(';')

  let renameCommitted = false
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      renameCommitted = true
      callbacks.onCommitRename(layer.id, input.value)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Escape') {
      renameCommitted = true
      callbacks.onCancelRename()
      event.preventDefault()
      event.stopPropagation()
    }
  })
  input.addEventListener('blur', () => {
    if (renameCommitted) {
      return
    }
    callbacks.onCommitRename(layer.id, input.value)
  })
  row.appendChild(input)
}
