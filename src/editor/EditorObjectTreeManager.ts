import * as fabric from 'fabric'

import { localizer } from '../Localizer'
import { ObjectType } from './types'
import type { EditorEmptyObject, EditorObjectData } from './types'

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
    insertAfter: boolean
  ) => void
  onDropToParent: (dragId: number, parentId: number) => void
  onDropToRoot: (dragId: number) => void
  onDragEnd: () => void
  onObjectSelected: (id: number, mode: 'replace' | 'toggle' | 'range') => void
  onObjectVisibilityToggled: (id: number) => void
  onBlankAreaSelected: () => void
  onObjectContextMenu: (id: number, clientX: number, clientY: number) => void
  onCollapsedPathsChanged: (paths: readonly string[]) => void
  selectedEditorObjectIds: number[]
}

export class EditorObjectTreeManager {
  private editorObjectTree: HTMLDivElement
  private context: EditorObjectTreeManagerContext
  private dragPreviewId = -1
  private dragPreviewAfter = false
  private dragParentPreviewId = -1
  private collapsedPathSet = new Set<string>()
  private readonly visibleObjectIdScratch: number[] = []

  constructor(context: EditorObjectTreeManagerContext) {
    this.context = context

    const objectTree = document.getElementById('editorObjectTree')
    if (!(objectTree instanceof HTMLDivElement)) {
      throw new Error('Editor object tree element is missing.')
    }
    this.editorObjectTree = objectTree

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.editorObjectTree.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const visibilityButton = target?.closest<HTMLElement>(
        '.editor-object-visibility'
      )
      if (visibilityButton) {
        const node = visibilityButton.closest<HTMLButtonElement>(
          '.editor-object-node'
        )
        if (!node?.dataset.objectId) {
          return
        }
        const objectId = Number.parseInt(node.dataset.objectId, 10)
        if (!Number.isFinite(objectId)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        this.context.onObjectVisibilityToggled(objectId)
        return
      }
      const node = target?.closest<HTMLButtonElement>('.editor-object-node')
      if (!node?.dataset.objectId) {
        if (target?.closest('.editor-object-toggle')) {
          return
        }
        this.context.onBlankAreaSelected()
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

    this.editorObjectTree.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement | null
      const node = target?.closest<HTMLButtonElement>('.editor-object-node')
      if (!node?.dataset.objectId) {
        return
      }
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      if (!Number.isFinite(objectId)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.context.onObjectContextMenu(objectId, event.clientX, event.clientY)
    })

    window.addEventListener('dragover', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      event.preventDefault()

      const target = event.target as HTMLElement | null
      const isOverTree =
        this.editorObjectTree.contains(target) ||
        target === this.editorObjectTree

      if (!isOverTree) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
        return
      }

      if (
        target === this.editorObjectTree ||
        target?.classList.contains('editor-object-children')
      ) {
        const nodes = Array.from(
          this.editorObjectTree.querySelectorAll('.editor-object-node')
        ) as HTMLElement[]
        if (nodes.length > 0) {
          const firstRect = nodes[0].getBoundingClientRect()
          const lastRect = nodes[nodes.length - 1].getBoundingClientRect()

          if (event.clientY < firstRect.top + firstRect.height) {
            const id = Number.parseInt(nodes[0].dataset.objectId || '-1', 10)
            if (id !== -1) {
              this.updateDragPreview(id, false)
              this.clearParentPreview()
            }
          } else if (event.clientY > lastRect.top) {
            const id = Number.parseInt(
              nodes[nodes.length - 1].dataset.objectId || '-1',
              10
            )
            if (id !== -1) {
              this.updateDragPreview(id, true)
              this.clearParentPreview()
            }
          }
        }
      }

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    })

    window.addEventListener('drop', (event) => {
      if (this.context.dragObjectId === -1) {
        return
      }
      event.preventDefault()
      this.handleDropExecution()
      this.resetDragState()
    })
  }

  private handleDropExecution() {
    if (this.dragParentPreviewId !== -1) {
      this.context.onDropToParent(
        this.context.dragObjectId,
        this.dragParentPreviewId
      )
    } else if (this.dragPreviewId !== -1) {
      this.context.onDropReorder(
        this.context.dragObjectId,
        this.dragPreviewId,
        this.dragPreviewAfter
      )
    } else {
      this.context.onDropToRoot(this.context.dragObjectId)
    }
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

    const visiblePathSet = new Set<string>()
    for (let i = 0; i < roots.length; i++) {
      this.renderObjectNode(
        roots[i],
        childrenMap,
        this.editorObjectTree,
        String(i),
        visiblePathSet
      )
    }

    let changed = false
    this.collapsedPathSet.forEach((path) => {
      if (!visiblePathSet.has(path)) {
        this.collapsedPathSet.delete(path)
        changed = true
      }
    })
    if (changed) {
      this.notifyCollapsedPathsChanged()
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

  public getVisibleObjectIdsInRenderOrder(): readonly number[] {
    const result = this.visibleObjectIdScratch
    result.length = 0
    this.collectVisibleObjectIds(this.editorObjectTree, result)
    return result
  }

  private collectVisibleObjectIds(container: Element, result: number[]): void {
    const children = container.children
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (
        child instanceof HTMLDetailsElement &&
        child.classList.contains('editor-object-group')
      ) {
        const summary = child.firstElementChild
        if (summary instanceof HTMLElement) {
          this.pushObjectIdFromContainer(summary, result)
        }
        if (child.open) {
          this.collectVisibleGroupChildIds(child, result)
        }
        continue
      }
      if (child instanceof HTMLElement) {
        this.pushObjectIdFromElement(child, result)
      }
    }
  }

  private collectVisibleGroupChildIds(
    details: HTMLDetailsElement,
    result: number[]
  ): void {
    const children = details.children
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (
        child instanceof HTMLElement &&
        child.classList.contains('editor-object-children')
      ) {
        this.collectVisibleObjectIds(child, result)
        return
      }
    }
  }

  private pushObjectIdFromContainer(
    container: HTMLElement,
    result: number[]
  ): void {
    const children = container.children
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child instanceof HTMLElement) {
        this.pushObjectIdFromElement(child, result)
      }
    }
  }

  private pushObjectIdFromElement(
    element: HTMLElement,
    result: number[]
  ): void {
    if (
      !element.classList.contains('editor-object-node') &&
      !element.classList.contains('editor-object-rename-input')
    ) {
      return
    }
    const objectId = Number.parseInt(element.dataset.objectId ?? '', 10)
    if (Number.isFinite(objectId)) {
      result.push(objectId)
    }
  }

  private renderObjectNode(
    data: EditorObjectData,
    childrenMap: Map<number, EditorObjectData[]>,
    container: HTMLElement,
    path: string,
    visiblePathSet: Set<string>
  ) {
    const children = childrenMap.get(data.id) ?? []
    const isRenaming = data.id === this.context.renamingEditorObjectId
    const hasChildren = children.length > 0

    if (hasChildren) {
      visiblePathSet.add(path)
      const details = document.createElement('details')
      details.className = 'editor-object-group'
      details.open = !this.collapsedPathSet.has(path)
      details.addEventListener('toggle', () => {
        if (details.open) {
          this.collapsedPathSet.delete(path)
        } else {
          this.collapsedPathSet.add(path)
        }
        this.notifyCollapsedPathsChanged()
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
        if (target === childContainer) {
          event.preventDefault()
          this.clearDragPreview()
          this.updateParentPreview(data.id)
        }
      })

      for (let i = 0; i < children.length; i++) {
        this.renderObjectNode(
          children[i],
          childrenMap,
          childContainer,
          `${path}/${i}`,
          visiblePathSet
        )
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

    // No children, but still could be a renaming state
    if (isRenaming) {
      const input = this.renderRenameInput(data)
      container.appendChild(input)
      input.focus()
      input.select()
      return
    }

    // Default node button
    container.appendChild(this.createObjectNodeButton(data))
  }

  private createObjectNodeButton(data: EditorObjectData) {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'editor-object-node'
    node.draggable = !data.isLocked
    if (this.context.selectedEditorObjectIds.includes(data.id)) {
      node.classList.add('is-selected')
    }
    if (data.isLocked) {
      node.classList.add('is-locked')
    }
    if (!data.isVisible) {
      node.classList.add('is-hidden')
    }
    node.dataset.objectId = String(data.id)
    if (this.isGroupContainerData(data)) {
      const icon = document.createElement('span')
      icon.className = 'editor-object-status editor-object-group-icon'
      icon.setAttribute('aria-hidden', 'true')
      node.appendChild(icon)
    }
    const label = document.createElement('span')
    label.className = 'editor-object-label'
    label.textContent = data.name
    node.appendChild(label)
    if (data.isLocked) {
      const lockIcon = document.createElement('span')
      lockIcon.className = 'editor-object-status editor-object-lock-icon'
      lockIcon.setAttribute('aria-hidden', 'true')
      node.appendChild(lockIcon)
    }
    node.appendChild(this.createVisibilityToggle(data))
    node.addEventListener('dragstart', (event) => {
      if (data.isLocked) {
        event.preventDefault()
        return
      }
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

      // All nodes now support "inside" drop to become parents recursively
      const threshold = rect.height * 0.25
      const upper = rect.top + threshold
      const lower = rect.bottom - threshold

      if (event.clientY > upper && event.clientY < lower) {
        this.clearDragPreview()
        this.updateParentPreview(data.id)
      } else {
        this.clearParentPreview()
        const insertAfter = event.clientY >= rect.top + rect.height * 0.5
        this.updateDragPreview(data.id, insertAfter)
      }

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    })
    node.addEventListener('dragend', () => {
      this.resetDragState()
      this.context.onDragEnd()
    })
    return node
  }

  private createVisibilityToggle(data: EditorObjectData) {
    const toggle = document.createElement('span')
    const visible = data.isVisible
    toggle.className = visible
      ? 'editor-object-status editor-object-visibility'
      : 'editor-object-status editor-object-visibility is-hidden'
    toggle.setAttribute('role', 'button')
    toggle.setAttribute(
      'aria-label',
      localizer.t(visible ? 'editor_object_hide' : 'editor_object_show')
    )
    toggle.title = localizer.t(
      visible ? 'editor_object_hide' : 'editor_object_show'
    )
    return toggle
  }

  private isGroupContainerData(data: EditorObjectData): boolean {
    if (data.type !== ObjectType.Empty) {
      return false
    }
    const emptyObject = data.object as fabric.Object &
      Partial<EditorEmptyObject>
    return emptyObject.isGroupContainer === true
  }

  private updateDragPreview(id: number, insertAfter: boolean) {
    if (this.dragPreviewId === id && this.dragPreviewAfter === insertAfter) {
      return
    }
    this.clearDragPreview()
    if (this.context.selectedEditorObjectIds.includes(id)) {
      return
    }
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

  private updateParentPreview(id: number) {
    if (this.dragParentPreviewId === id) {
      return
    }
    this.clearParentPreview()
    if (this.context.selectedEditorObjectIds.includes(id)) {
      return
    }
    const selector = `.editor-object-node[data-object-id="${id}"]`
    const node =
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (node) {
      this.dragParentPreviewId = id
      node.classList.add('is-drop-parent')
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

  public updateContext(updates: Partial<EditorObjectTreeManagerContext>) {
    Object.assign(this.context, updates)
  }

  public setCollapsedPaths(paths: readonly string[]): void {
    this.collapsedPathSet.clear()
    for (let i = 0; i < paths.length; i++) {
      this.collapsedPathSet.add(paths[i])
    }
  }

  private notifyCollapsedPathsChanged(): void {
    this.context.onCollapsedPathsChanged(Array.from(this.collapsedPathSet))
  }
}
