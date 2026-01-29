import type { EditorObjectData } from './types'

export interface EditorObjectTreeManagerContext {
  editorObjectTree: HTMLDivElement
  editorObjects: EditorObjectData[]
  renamingEditorObjectId: number
  selectedEditorObjectId: number
  dragObjectId: number
  onRenameCommit: (id: number, value: string) => void
  onRenameCancel: () => void
  onDragStart: (id: number) => void
  onDragOver: (targetId: number, insertAfter: boolean) => void
  onDrop: (dragId: number, targetId: number, insertAfter: boolean) => void
  onDragEnd: () => void
}

export class EditorObjectTreeManager {
  private context: EditorObjectTreeManagerContext
  private dragPreviewId = -1
  private dragPreviewAfter = false

  constructor(context: EditorObjectTreeManagerContext) {
    this.context = context
  }

  public renderObjectTree() {
    this.context.editorObjectTree.innerHTML = ''
    for (let i = 0; i < this.context.editorObjects.length; i++) {
      const data = this.context.editorObjects[i]
      if (data.id === this.context.renamingEditorObjectId) {
        this.renderRenameInput(data)
        continue
      }
      this.renderObjectNode(data)
    }
  }

  private renderRenameInput(data: EditorObjectData) {
    const input = document.createElement('input')
    input.className = 'editor-object-rename-input'
    input.value = data.name
    input.dataset.objectId = String(data.id)
    const commit = () => {
      this.context.onRenameCommit(data.id, input.value)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.context.onRenameCancel()
      }
    })
    this.context.editorObjectTree.appendChild(input)
    input.focus()
    input.select()
  }

  private renderObjectNode(data: EditorObjectData) {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'editor-object-node'
    node.draggable = true
    if (data.id === this.context.selectedEditorObjectId) {
      node.classList.add('is-selected')
    }
    node.dataset.objectId = String(data.id)
    node.textContent = data.name
    node.addEventListener('dragstart', (event) => {
      this.context.onDragStart(data.id)
      this.clearDragPreview()
      event.dataTransfer?.setData('text/plain', String(data.id))
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    })
    node.addEventListener('dragover', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const midY = rect.top + rect.height * 0.5
      const insertAfter = event.clientY >= midY
      this.context.onDragOver(data.id, insertAfter)
      this.updateDragPreviewFromTarget(data.id, insertAfter)
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    })
    node.addEventListener('drop', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const midY = rect.top + rect.height * 0.5
      const insertAfter = event.clientY >= midY
      this.context.onDrop(this.context.dragObjectId, data.id, insertAfter)
      this.resetDragState()
    })
    node.addEventListener('dragend', () => {
      this.resetDragState()
      this.context.onDragEnd()
    })
    this.context.editorObjectTree.appendChild(node)
  }

  public updateDragPreviewFromTarget(targetId: number, insertAfter: boolean) {
    if (targetId === this.context.dragObjectId) {
      this.clearDragPreview()
      return
    }
    const targetIndex = this.findEditorObjectIndexById(targetId)
    if (targetIndex === -1) {
      this.clearDragPreview()
      return
    }
    let previewId = targetId
    let previewAfter = insertAfter
    if (!insertAfter && targetIndex > 0) {
      previewId = this.context.editorObjects[targetIndex - 1].id
      previewAfter = true
    }
    if (previewId === this.context.dragObjectId) {
      this.clearDragPreview()
      return
    }
    this.updateDragPreview(previewId, previewAfter)
  }

  private updateDragPreview(id: number, insertAfter: boolean) {
    if (this.dragPreviewId === id && this.dragPreviewAfter === insertAfter) {
      return
    }
    this.clearDragPreview()
    const selector = `.editor-object-node[data-object-id="${id}"]`
    const node =
      this.context.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (!node) {
      return
    }
    this.dragPreviewId = id
    this.dragPreviewAfter = insertAfter
    if (insertAfter) {
      node.classList.add('is-drop-after')
    } else {
      node.classList.add('is-drop-before')
    }
  }

  public clearDragPreview() {
    if (this.dragPreviewId === -1) {
      return
    }
    const selector = `.editor-object-node[data-object-id="${this.dragPreviewId}"]`
    const node =
      this.context.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (node) {
      node.classList.remove('is-drop-before')
      node.classList.remove('is-drop-after')
    }
    this.dragPreviewId = -1
    this.dragPreviewAfter = false
  }

  public resetDragState() {
    this.clearDragPreview()
  }

  private findEditorObjectIndexById(id: number) {
    for (let i = 0; i < this.context.editorObjects.length; i++) {
      if (this.context.editorObjects[i].id === id) {
        return i
      }
    }
    return -1
  }

  public updateContext(
    updates: Partial<Omit<EditorObjectTreeManagerContext, 'editorObjectTree'>>
  ) {
    Object.assign(this.context, updates)
  }
}
