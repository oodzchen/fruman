import type { fabric } from 'fabric'

import { localizer } from '../Localizer'
import type { EditablePolygon } from './EditorPolygonEditor'

export type ContextMenuAction =
  | 'add'
  | 'remove'
  | 'delete'
  | 'reset'
  | 'square'
  | 'equilateral'
  | 'zoom'
  | 'rename'
  | 'group'
  | 'convertGroup'
  | 'ungroup'
  | 'lock'
  | 'unlock'
  | 'properties'
  | 'copy'
  | 'paste'

export interface EditorContextMenuContext {
  editorWorkspace: HTMLDivElement
  isEditablePolygon: (object: fabric.Object) => boolean
  onAction: (action: ContextMenuAction) => void
  canPaste: () => boolean
  canCopy: (target: fabric.Object) => boolean
  isActionDisabled: (
    action: ContextMenuAction,
    target: fabric.Object | null
  ) => boolean
}

export class EditorContextMenu {
  private ctx: EditorContextMenuContext
  private polygonMenu: HTMLDivElement
  private polygonMenuButtons: HTMLButtonElement[]
  private actions: ContextMenuAction[] = []
  private polygon: EditablePolygon | null = null
  private target: fabric.Object | null = null
  private pointIndex = -1
  private insertX = 0
  private insertY = 0

  constructor(ctx: EditorContextMenuContext) {
    this.ctx = ctx

    const polygonMenu = document.getElementById('editorPolygonMenu')
    const polygonMenuPrimary = document.getElementById(
      'editorPolygonMenuPrimary'
    )
    const polygonMenuSecondary = document.getElementById(
      'editorPolygonMenuSecondary'
    )
    const polygonMenuTertiary = document.getElementById(
      'editorPolygonMenuTertiary'
    )
    const polygonMenuQuaternary = document.getElementById(
      'editorPolygonMenuQuaternary'
    )
    const polygonMenuQuinary = document.getElementById(
      'editorPolygonMenuQuinary'
    )
    const polygonMenuSenary = document.getElementById('editorPolygonMenuSenary')
    const polygonMenuSeptenary = document.getElementById(
      'editorPolygonMenuSeptenary'
    )

    if (
      !(polygonMenu instanceof HTMLDivElement) ||
      !(polygonMenuPrimary instanceof HTMLButtonElement) ||
      !(polygonMenuSecondary instanceof HTMLButtonElement) ||
      !(polygonMenuTertiary instanceof HTMLButtonElement) ||
      !(polygonMenuQuaternary instanceof HTMLButtonElement) ||
      !(polygonMenuQuinary instanceof HTMLButtonElement) ||
      !(polygonMenuSenary instanceof HTMLButtonElement) ||
      !(polygonMenuSeptenary instanceof HTMLButtonElement)
    ) {
      throw new Error('EditorContextMenu: required elements not found')
    }

    this.polygonMenu = polygonMenu
    this.polygonMenuButtons = [
      polygonMenuPrimary,
      polygonMenuSecondary,
      polygonMenuTertiary,
      polygonMenuQuaternary,
      polygonMenuQuinary,
      polygonMenuSenary,
      polygonMenuSeptenary,
    ]

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.polygonMenuButtons.forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const action = button.dataset.action as ContextMenuAction | undefined
        if (!action) {
          return
        }
        if (button.disabled) {
          return
        }
        this.ctx.onAction(action)
        this.hide()
      })
    })

    this.polygonMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
  }

  getPolygon(): EditablePolygon | null {
    return this.polygon
  }

  getTarget(): fabric.Object | null {
    return this.target
  }

  getPointIndex(): number {
    return this.pointIndex
  }

  getInsertX(): number {
    return this.insertX
  }

  getInsertY(): number {
    return this.insertY
  }

  show(
    actions: ContextMenuAction[],
    target: EditablePolygon | fabric.Object,
    index: number,
    clientX: number,
    clientY: number,
    insertX?: number,
    insertY?: number
  ) {
    this.actions = actions
    this.polygon = this.ctx.isEditablePolygon(target)
      ? (target as EditablePolygon)
      : null
    this.target = target
    this.pointIndex = index
    this.insertX = insertX ?? 0
    this.insertY = insertY ?? 0

    for (let i = 0; i < this.polygonMenuButtons.length; i++) {
      const button = this.polygonMenuButtons[i]
      const action = this.actions[i]
      if (!action) {
        button.dataset.action = ''
        button.disabled = false
        button.classList.remove('disabled')
        button.classList.add('is-hidden')
        continue
      }
      button.dataset.action = action
      button.textContent = localizer.t(this.getLabel(action))
      button.classList.remove('is-hidden')
      const isPasteDisabled = action === 'paste' && !this.ctx.canPaste()
      const isCopyDisabled =
        action === 'copy' && !!this.target && !this.ctx.canCopy(this.target)
      const isActionDisabled = this.ctx.isActionDisabled(action, this.target)
      if (isPasteDisabled || isCopyDisabled || isActionDisabled) {
        button.disabled = true
        button.classList.add('disabled')
        continue
      }
      button.disabled = false
      button.classList.remove('disabled')
    }

    this.polygonMenu.classList.add('is-visible')
    this.adjustPosition(clientX, clientY)
  }

  hide() {
    if (!this.polygonMenu.classList.contains('is-visible')) {
      return
    }
    this.polygonMenu.classList.remove('is-visible')
    this.actions.length = 0
    this.polygon = null
    this.target = null
    this.pointIndex = -1
  }

  isVisible(): boolean {
    return this.polygonMenu.classList.contains('is-visible')
  }

  containsTarget(target: Node): boolean {
    return this.polygonMenu.contains(target)
  }

  private getLabel(action: ContextMenuAction): string {
    switch (action) {
      case 'add':
        return 'editor_polygon_menu_add_point'
      case 'remove':
        return 'editor_polygon_menu_remove_point'
      case 'reset':
        return 'editor_polygon_menu_reset_shape'
      case 'square':
        return 'editor_polygon_menu_make_square'
      case 'equilateral':
        return 'editor_polygon_menu_make_equilateral'
      case 'zoom':
        return 'editor_camera_menu_zoom'
      case 'rename':
        return 'editor_object_menu_rename'
      case 'group':
        return 'editor_object_menu_group'
      case 'convertGroup':
        return 'editor_object_menu_convert_group'
      case 'ungroup':
        return 'editor_object_menu_ungroup'
      case 'lock':
        return 'editor_object_menu_lock'
      case 'unlock':
        return 'editor_object_menu_unlock'
      case 'properties':
        return 'editor_weapon_menu_properties'
      case 'copy':
        return 'editor_object_menu_copy'
      case 'paste':
        return 'editor_object_menu_paste'
      default:
        return 'editor_polygon_menu_delete_shape'
    }
  }

  private adjustPosition(x: number, y: number) {
    const menu = this.polygonMenu
    const wasVisible = menu.classList.contains('is-visible')
    if (!wasVisible) {
      menu.style.visibility = 'hidden'
      menu.classList.add('is-visible')
    }

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    const rect = menu.getBoundingClientRect()
    const viewportRect = this.ctx.editorWorkspace.getBoundingClientRect()

    let newX = x
    let newY = y

    if (newX + rect.width > viewportRect.right) {
      newX = viewportRect.right - rect.width - 4
    }
    if (newY + rect.height > viewportRect.bottom) {
      newY = viewportRect.bottom - rect.height - 4
    }
    if (newX < viewportRect.left + 4) {
      newX = viewportRect.left + 4
    }
    if (newY < viewportRect.top + 4) {
      newY = viewportRect.top + 4
    }

    menu.style.left = `${newX}px`
    menu.style.top = `${newY}px`

    if (!wasVisible) {
      menu.classList.remove('is-visible')
      menu.style.visibility = ''
    }
  }
}
