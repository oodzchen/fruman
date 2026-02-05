import type { EditorObjectData } from './types'

export interface EditorObjectTreeManagerContext {
  editorObjects: EditorObjectData[]
  renamingEditorObjectId: number
  selectedEditorObjectId: number
  dragObjectId: number
  onRenameCommit: (id: number, value: string) => void
  onRenameCancel: () => void
  onDragStart: (id: number) => void
  onDropReorder: (
    dragId: number,
    targetId: number,
    insertAfter: boolean,
    targetParentId: number | null
  ) => void
  onDropToParent: (dragId: number, parentId: number) => void
  onDropToRoot: (dragId: number) => void
  onDragEnd: () => void
  onObjectSelected: (id: number, mode: 'replace' | 'toggle' | 'range') => void
  selectedEditorObjectIds: number[]
}

export class EditorObjectTreeManager {
  private editorObjectTree: HTMLDivElement
  private context: EditorObjectTreeManagerContext
  private dragPreviewId = -1
  private dragPreviewAfter = false
  private dragParentPreviewId = -1
  private groupOpenMap = new Map<number, boolean>()

  constructor(context: EditorObjectTreeManagerContext) {
    this.context = context

    const objectTree = document.getElementById('editorObjectTree')
    if (!(objectTree instanceof HTMLDivElement)) {
      throw new Error('Editor object tree element is missing.')
    }
    this.editorObjectTree = objectTree

    this.editorObjectTree.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const node = target?.closest<HTMLButtonElement>('.editor-object-node')
      if (!node?.dataset.objectId) {
        return
      }
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      const isToggle = event.ctrlKey || event.metaKey
      const isRange = event.shiftKey
      this.context.onObjectSelected(
        objectId,
        isRange ? 'range' : isToggle ? 'toggle' : 'replace'
      )
    })

    this.editorObjectTree.addEventListener('dragover', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target?.closest('.editor-object-node') ||
        target?.closest('.editor-object-children')
      ) {
        return
      }
      event.preventDefault()
      this.clearDragPreview()
      this.clearParentPreview()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    })

    this.editorObjectTree.addEventListener('drop', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target?.closest('.editor-object-node') ||
        target?.closest('.editor-object-children')
      ) {
        return
      }
      event.preventDefault()
      if (this.dragParentPreviewId !== -1) {
        this.context.onDropToParent(
          this.context.dragObjectId,
          this.dragParentPreviewId
        )
      } else if (this.dragPreviewId !== -1) {
        const targetIndex = this.findEditorObjectIndexById(this.dragPreviewId)
        const targetParentId =
          targetIndex !== -1
            ? this.context.editorObjects[targetIndex].parentId
            : null
        this.context.onDropReorder(
          this.context.dragObjectId,
          this.dragPreviewId,
          this.dragPreviewAfter,
          targetParentId
        )
      } else {
        this.context.onDropToRoot(this.context.dragObjectId)
      }
      this.resetDragState()
    })
  }

  public renderObjectTree() {
    this.editorObjectTree.innerHTML = ''
    const childrenMap = new Map<number, EditorObjectData[]>()
    const roots: EditorObjectData[] = []
    for (let i = 0; i < this.context.editorObjects.length; i++) {
      const data = this.context.editorObjects[i]
      if (data.parentId === null) {
        roots.push(data)
        continue
      }
      const parentList = childrenMap.get(data.parentId)
      if (parentList) {
        parentList.push(data)
      } else {
        childrenMap.set(data.parentId, [data])
      }
    }

    for (let i = 0; i < roots.length; i++) {
      this.renderObjectNode(roots[i], childrenMap, this.editorObjectTree)
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
    return input
  }

  private renderObjectNode(
    data: EditorObjectData,
    childrenMap: Map<number, EditorObjectData[]>,
    container: HTMLElement
  ) {
    const children = childrenMap.get(data.id) ?? []
    const isRenaming = data.id === this.context.renamingEditorObjectId
    if (children.length > 0) {
      const details = document.createElement('details')
      details.className = 'editor-object-group'
      details.open = this.groupOpenMap.get(data.id) ?? true
      details.addEventListener('toggle', () => {
        this.groupOpenMap.set(data.id, details.open)
      })
      const summary = document.createElement('summary')
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'editor-object-toggle'
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        details.open = !details.open
        this.groupOpenMap.set(data.id, details.open)
      })
      summary.appendChild(toggle)
      if (isRenaming) {
        summary.appendChild(this.renderRenameInput(data))
      } else {
        summary.appendChild(this.createObjectNodeButton(data))
      }
      details.appendChild(summary)

      const childContainer = document.createElement('div')
      childContainer.className = 'editor-object-children'
      childContainer.dataset.parentId = String(data.id)
      childContainer.addEventListener('dragover', (event) => {
        if (this.context.dragObjectId === -1) {
          return
        }
        const target = event.target as HTMLElement | null
        if (target?.closest('.editor-object-node')) {
          return
        }
        event.preventDefault()
        this.clearDragPreview()
        if (this.dragParentPreviewId !== data.id) {
          this.clearParentPreview()
          this.dragParentPreviewId = data.id
          const selector = `.editor-object-node[data-object-id="${data.id}"]`
          const node =
            this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
          if (node) {
            node.classList.add('is-drop-parent')
          }
        }
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
      })
      childContainer.addEventListener('dragleave', () => {
        this.clearParentPreview()
      })
      childContainer.addEventListener('drop', (event) => {
        if (this.context.dragObjectId === -1) {
          return
        }
        const target = event.target as HTMLElement | null
        if (target?.closest('.editor-object-node')) {
          return
        }
        event.preventDefault()
        this.context.onDropToParent(this.context.dragObjectId, data.id)
        this.resetDragState()
      })

      for (let i = 0; i < children.length; i++) {
        this.renderObjectNode(children[i], childrenMap, childContainer)
      }

      details.appendChild(childContainer)
      container.appendChild(details)
      if (isRenaming) {
        const input = summary.querySelector<HTMLInputElement>(
          '.editor-object-rename-input'
        )
        input?.focus()
        input?.select()
      }
      return
    }

    if (isRenaming) {
      const input = this.renderRenameInput(data)
      container.appendChild(input)
      input.focus()
      input.select()
      return
    }

    container.appendChild(this.createObjectNodeButton(data))
  }

  private createObjectNodeButton(data: EditorObjectData) {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'editor-object-node'
    node.draggable = true
    if (this.context.selectedEditorObjectIds.includes(data.id)) {
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
      const upper = rect.top + rect.height * 0.3
      const lower = rect.top + rect.height * 0.7
      if (event.clientY > upper && event.clientY < lower) {
        this.clearDragPreview()
        this.clearParentPreview()
        this.dragParentPreviewId = data.id
        node.classList.add('is-drop-parent')
      } else {
        this.clearParentPreview()
        const insertAfter = event.clientY >= rect.top + rect.height * 0.5
        this.updateDragPreviewFromTarget(data.id, insertAfter)
      }
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
      const upper = rect.top + rect.height * 0.3
      const lower = rect.top + rect.height * 0.7
      if (event.clientY > upper && event.clientY < lower) {
        this.context.onDropToParent(this.context.dragObjectId, data.id)
      } else {
        const insertAfter = event.clientY >= rect.top + rect.height * 0.5
        this.context.onDropReorder(
          this.context.dragObjectId,
          data.id,
          insertAfter,
          data.parentId
        )
      }
      this.resetDragState()
    })
    node.addEventListener('dragend', () => {
      this.resetDragState()
      this.context.onDragEnd()
    })
    return node
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
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
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
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (node) {
      node.classList.remove('is-drop-before')
      node.classList.remove('is-drop-after')
    }
    this.dragPreviewId = -1
    this.dragPreviewAfter = false
  }

  private clearParentPreview() {
    if (this.dragParentPreviewId === -1) {
      return
    }
    const selector = `.editor-object-node[data-object-id="${this.dragParentPreviewId}"]`
    const node =
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (node) {
      node.classList.remove('is-drop-parent')
    }
    this.dragParentPreviewId = -1
  }

  public resetDragState() {
    this.clearDragPreview()
    this.clearParentPreview()
  }

  private findEditorObjectIndexById(id: number) {
    for (let i = 0; i < this.context.editorObjects.length; i++) {
      if (this.context.editorObjects[i].id === id) {
        return i
      }
    }
    return -1
  }

  public updateContext(updates: Partial<EditorObjectTreeManagerContext>) {
    Object.assign(this.context, updates)
  }
}
