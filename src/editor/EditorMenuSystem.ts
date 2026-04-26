import { localizer } from '../Localizer'
import { WEAPON_DEFAULT_DATA } from '../constants'
import type {
  MapEnvironmentAsset,
  MapEnvironmentObjectType,
  MapNpcTemplate,
  WeaponCategory,
} from '../editorMapTypes'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type { TerrainBrushId, TerrainMaterialId } from '../terrain/TerrainTypes'
import type { NpcType, WeaponType } from '../types'
import { getWeaponGroundRotationRad } from '../weaponTypeUtils'
import { DEBUG_EDITOR_MENU } from './EditorConstants'
import { EditorMenuNavigator, EditorSubmenuMode } from './EditorMenuNavigator'
import { computeWeaponRenderDimensions } from './EditorRenderUtils'
import { ObjectType } from './types'
import type { GroundShapeType } from './types'

export type EditorObjectMenuType =
  | ObjectType
  | 'terrainMaterial'
  | 'terrainContour'
  | 'prop'
  | 'environment'

export interface EditorMenuSystemContext {
  editorWorkspace: HTMLDivElement
  hasObjectOfType: (type: ObjectType) => boolean
  hasWeaponType: (weaponType: WeaponType) => boolean
  onObjectTypeSelected: (type: EditorObjectMenuType) => void
  onTerrainBrushSelected: (brushId: TerrainBrushId) => void
  onTerrainFillSelected: (materialId: TerrainMaterialId) => void
  onTerrainContourDrawSelected: () => void
  onTerrainContourShapeSelected: (shape: GroundShapeType) => void
  onWeaponSelected: (
    weaponType: WeaponType,
    category: WeaponCategory,
    size?: number
  ) => void
  onNpcSelected: (npcType: NpcType) => void
  getCustomNpcTemplates: () => MapNpcTemplate[]
  onCustomNpcTemplateSelected: (templateId: string) => void
  onEditCustomNpcTemplate: (templateId: string) => void | Promise<void>
  onCreateCustomNpcTemplate: () => void | Promise<void>
  onSunPickupSelected: (isLarge: boolean) => void
  onExpOrbSelected: () => void
  onEnvironmentObjectSelected: (envType: MapEnvironmentObjectType) => void
  getCustomEnvironmentAssets: () => MapEnvironmentAsset[]
  onCustomEnvironmentAssetSelected: (assetId: string) => void | Promise<void>
  onCreateCustomEnvironmentAsset: () => void | Promise<void>
  onPanelMenuAdd: () => void
  onPanelMenuPaste: () => void
  onPanelMenuMapSettings: () => void
  onPanelMenuAssetManager: () => void
}

export class EditorMenuSystem {
  private ctx: EditorMenuSystemContext
  private editorWorkspace: HTMLDivElement
  private objectTypeMenu: HTMLDivElement
  private panelMenu: HTMLDivElement
  private panelMenuAddBtn: HTMLButtonElement
  private panelMenuPasteBtn: HTMLButtonElement
  private panelMenuMapSettingsBtn: HTMLButtonElement
  private panelMenuAssetManagerBtn: HTMLButtonElement
  private terrainSubmenu: HTMLDivElement
  private terrainContourSubmenu: HTMLDivElement
  private terrainFillSubmenu: HTMLDivElement
  private weaponMenu: HTMLDivElement
  private npcSubmenu: HTMLDivElement
  private npcCustomTemplateList: HTMLDivElement
  private npcCustomTemplateTitle: HTMLDivElement
  private npcTemplateAddBtn: HTMLButtonElement
  private propSubmenu: HTMLDivElement
  private environmentSubmenu: HTMLDivElement
  private environmentCustomAssetList: HTMLDivElement
  private environmentCustomAssetTitle: HTMLDivElement
  private environmentAssetAddBtn: HTMLButtonElement
  private terrainMenuItem: HTMLButtonElement
  private terrainContourMenuItem: HTMLButtonElement
  private weaponMenuItem: HTMLButtonElement
  private npcMenuItem: HTMLButtonElement
  private propMenuItem: HTMLButtonElement
  private environmentMenuItem: HTMLButtonElement
  private editorObjectItems: NodeListOf<HTMLButtonElement>
  private terrainSubmenuItems: NodeListOf<HTMLButtonElement>
  private terrainContourSubmenuItems: NodeListOf<HTMLButtonElement>
  private terrainFillSubmenuItems: NodeListOf<HTMLButtonElement>
  private weaponItems: NodeListOf<HTMLButtonElement>
  private weaponGroupTitles: NodeListOf<HTMLDivElement>
  private npcSubmenuItems: HTMLButtonElement[] = []
  private propSubmenuItems: NodeListOf<HTMLButtonElement>
  private environmentSubmenuItems: HTMLButtonElement[] = []
  private propSubmenuBackBtn: HTMLButtonElement
  private environmentSubmenuBackBtn: HTMLButtonElement
  private objectTypeMenuBackBtn: HTMLButtonElement
  private terrainSubmenuBackBtn: HTMLButtonElement
  private terrainContourSubmenuBackBtn: HTMLButtonElement
  private terrainFillSubmenuBackBtn: HTMLButtonElement
  private weaponMenuBackBtn: HTMLButtonElement
  private npcSubmenuBackBtn: HTMLButtonElement
  private readonly weaponPreviewPixelsPerMeter = 16

  private menuNavigator: EditorMenuNavigator
  private menuMode: EditorSubmenuMode = EditorSubmenuMode.None
  private menuSelectedIndex = 0
  private panelMenuX = 0
  private panelMenuY = 0
  private objectTypeMenuX = 0
  private objectTypeMenuY = 0
  private boundHandleMenuItemMouseEnter: (event: Event) => void

  constructor(ctx: EditorMenuSystemContext) {
    this.ctx = ctx
    this.editorWorkspace = ctx.editorWorkspace

    const objectTypeMenu = document.getElementById('editorObjectTypeMenu')
    const panelMenu = document.getElementById('editorPanelMenu')
    const panelMenuPaste = document.getElementById('editorPanelMenuPaste')
    const panelMenuAdd = document.getElementById('editorPanelMenuAdd')
    const panelMenuMapSettings = document.getElementById(
      'editorPanelMenuMapSettings'
    )
    const panelMenuAssetManager = document.getElementById(
      'editorPanelMenuAssetManager'
    )
    const terrainSubmenu = document.getElementById('editorTerrainSubmenu')
    const terrainFillSubmenu = document.getElementById(
      'editorTerrainFillSubmenu'
    )
    const terrainContourSubmenu = document.getElementById(
      'editorTerrainContourSubmenu'
    )
    const weaponMenu = document.getElementById('editorWeaponMenu')
    const npcSubmenu = document.getElementById('editorNpcSubmenu')
    const npcCustomTemplateList = document.getElementById(
      'editorNpcCustomTemplateList'
    )
    const npcCustomTemplateTitle = document.getElementById(
      'editorNpcCustomTemplateTitle'
    )
    const npcTemplateAddBtn = document.getElementById('editorNpcTemplateAddBtn')
    const propSubmenu = document.getElementById('editorPropSubmenu')
    const environmentSubmenu = document.getElementById(
      'editorEnvironmentSubmenu'
    )
    const environmentCustomAssetList = document.getElementById(
      'editorEnvironmentCustomAssetList'
    )
    const environmentCustomAssetTitle = document.getElementById(
      'editorEnvironmentCustomAssetTitle'
    )
    const environmentAssetAddBtn = document.getElementById(
      'editorEnvironmentAssetAddBtn'
    )

    const terrainMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="terrainMaterial"]'
    )
    const terrainContourMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="terrainContour"]'
    )
    const weaponMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="weapon"]'
    )
    const npcMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="npc"]'
    )
    const propMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="prop"]'
    )
    const environmentMenuItem = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="environment"]'
    )

    const editorObjectItems = document.querySelectorAll<HTMLButtonElement>(
      '.editor-object-item'
    )
    const terrainSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorTerrainSubmenu .editor-submenu-item'
    )
    const terrainFillSubmenuItems =
      document.querySelectorAll<HTMLButtonElement>(
        '#editorTerrainFillSubmenu .editor-submenu-item'
      )
    const terrainContourSubmenuItems =
      document.querySelectorAll<HTMLButtonElement>(
        '#editorTerrainContourSubmenu .editor-submenu-item'
      )
    const weaponItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item'
    )
    const weaponGroupTitles = document.querySelectorAll<HTMLDivElement>(
      '#editorWeaponMenu .editor-submenu-group-title'
    )
    const propSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorPropSubmenu .editor-submenu-item'
    )
    const environmentSubmenuItems =
      document.querySelectorAll<HTMLButtonElement>(
        '#editorEnvironmentSubmenu .editor-submenu-item'
      )

    const objectTypeMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorObjectTypeMenu .editor-object-item[data-action="back"]'
    )
    const terrainSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorTerrainSubmenu .editor-submenu-item[data-action="back"]'
    )
    const terrainFillSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorTerrainFillSubmenu .editor-submenu-item[data-action="back"]'
    )
    const terrainContourSubmenuBackBtn =
      document.querySelector<HTMLButtonElement>(
        '#editorTerrainContourSubmenu .editor-submenu-item[data-action="back"]'
      )
    const weaponMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item[data-action="back"]'
    )
    const npcSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorNpcSubmenu .editor-submenu-item[data-action="back"]'
    )
    const propSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorPropSubmenu .editor-submenu-item[data-action="back"]'
    )
    const environmentSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorEnvironmentSubmenu .editor-submenu-item[data-action="back"]'
    )

    if (
      !(objectTypeMenu instanceof HTMLDivElement) ||
      !(panelMenu instanceof HTMLDivElement) ||
      !(panelMenuPaste instanceof HTMLButtonElement) ||
      !(panelMenuAdd instanceof HTMLButtonElement) ||
      !(panelMenuMapSettings instanceof HTMLButtonElement) ||
      !(panelMenuAssetManager instanceof HTMLButtonElement) ||
      !(terrainSubmenu instanceof HTMLDivElement) ||
      !(terrainFillSubmenu instanceof HTMLDivElement) ||
      !(terrainContourSubmenu instanceof HTMLDivElement) ||
      !(weaponMenu instanceof HTMLDivElement) ||
      !(npcSubmenu instanceof HTMLDivElement) ||
      !(npcCustomTemplateList instanceof HTMLDivElement) ||
      !(npcCustomTemplateTitle instanceof HTMLDivElement) ||
      !(npcTemplateAddBtn instanceof HTMLButtonElement) ||
      !(propSubmenu instanceof HTMLDivElement) ||
      !(environmentSubmenu instanceof HTMLDivElement) ||
      !(environmentCustomAssetList instanceof HTMLDivElement) ||
      !(environmentCustomAssetTitle instanceof HTMLDivElement) ||
      !(environmentAssetAddBtn instanceof HTMLButtonElement) ||
      !(terrainMenuItem instanceof HTMLButtonElement) ||
      !(terrainContourMenuItem instanceof HTMLButtonElement) ||
      !(weaponMenuItem instanceof HTMLButtonElement) ||
      !(npcMenuItem instanceof HTMLButtonElement) ||
      !(propMenuItem instanceof HTMLButtonElement) ||
      !(environmentMenuItem instanceof HTMLButtonElement) ||
      !(objectTypeMenuBackBtn instanceof HTMLButtonElement) ||
      !(terrainSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(terrainFillSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(terrainContourSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(weaponMenuBackBtn instanceof HTMLButtonElement) ||
      !(npcSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(propSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(environmentSubmenuBackBtn instanceof HTMLButtonElement)
    ) {
      throw new Error('EditorMenuSystem: required elements not found')
    }

    this.objectTypeMenu = objectTypeMenu
    this.panelMenu = panelMenu
    this.panelMenuPasteBtn = panelMenuPaste
    this.panelMenuAddBtn = panelMenuAdd
    this.panelMenuMapSettingsBtn = panelMenuMapSettings
    this.panelMenuAssetManagerBtn = panelMenuAssetManager
    this.terrainSubmenu = terrainSubmenu
    this.terrainContourSubmenu = terrainContourSubmenu
    this.terrainFillSubmenu = terrainFillSubmenu
    this.weaponMenu = weaponMenu
    this.npcSubmenu = npcSubmenu
    this.npcCustomTemplateList = npcCustomTemplateList
    this.npcCustomTemplateTitle = npcCustomTemplateTitle
    this.npcTemplateAddBtn = npcTemplateAddBtn
    this.propSubmenu = propSubmenu
    this.environmentSubmenu = environmentSubmenu
    this.environmentCustomAssetList = environmentCustomAssetList
    this.environmentCustomAssetTitle = environmentCustomAssetTitle
    this.environmentAssetAddBtn = environmentAssetAddBtn
    this.terrainMenuItem = terrainMenuItem
    this.terrainContourMenuItem = terrainContourMenuItem
    this.weaponMenuItem = weaponMenuItem
    this.npcMenuItem = npcMenuItem
    this.propMenuItem = propMenuItem
    this.environmentMenuItem = environmentMenuItem
    this.editorObjectItems = editorObjectItems
    this.terrainSubmenuItems = terrainSubmenuItems
    this.terrainContourSubmenuItems = terrainContourSubmenuItems
    this.terrainFillSubmenuItems = terrainFillSubmenuItems
    this.weaponItems = weaponItems
    this.weaponGroupTitles = weaponGroupTitles
    this.propSubmenuItems = propSubmenuItems
    this.environmentSubmenuItems = Array.from(environmentSubmenuItems)
    this.objectTypeMenuBackBtn = objectTypeMenuBackBtn
    this.terrainSubmenuBackBtn = terrainSubmenuBackBtn
    this.terrainContourSubmenuBackBtn = terrainContourSubmenuBackBtn
    this.terrainFillSubmenuBackBtn = terrainFillSubmenuBackBtn
    this.weaponMenuBackBtn = weaponMenuBackBtn
    this.npcSubmenuBackBtn = npcSubmenuBackBtn
    this.propSubmenuBackBtn = propSubmenuBackBtn
    this.environmentSubmenuBackBtn = environmentSubmenuBackBtn

    this.menuNavigator = new EditorMenuNavigator({
      getMenuItems: (mode) => this.getMenuItems(mode),
      getCurrentMode: () => this.menuMode,
      setCurrentMode: (mode) => {
        this.menuMode = mode
      },
      getCurrentSelectedIndex: () => this.menuSelectedIndex,
      setCurrentSelectedIndex: (index) => {
        this.menuSelectedIndex = index
      },
    })

    this.boundHandleMenuItemMouseEnter =
      this.handleMenuItemMouseEnter.bind(this)
    this.renderCustomNpcTemplateItems()
    this.renderCustomEnvironmentAssetItems()
    this.setupEventListeners()
  }

  private getMenuItems(mode: EditorSubmenuMode): ArrayLike<HTMLButtonElement> {
    switch (mode) {
      case EditorSubmenuMode.Object:
        return this.editorObjectItems
      case EditorSubmenuMode.Terrain:
        return this.terrainSubmenuItems
      case EditorSubmenuMode.TerrainContour:
        return this.terrainContourSubmenuItems
      case EditorSubmenuMode.TerrainFill:
        return this.terrainFillSubmenuItems
      case EditorSubmenuMode.Weapon:
        return this.weaponItems
      case EditorSubmenuMode.Npc:
        return this.npcSubmenuItems
      case EditorSubmenuMode.Prop:
        return this.propSubmenuItems
      case EditorSubmenuMode.Environment:
        return this.environmentSubmenuItems
      default:
        return this.editorObjectItems
    }
  }

  private setupEventListeners() {
    this.editorObjectItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const type = item.dataset.type as EditorObjectMenuType | undefined
        if (type === 'terrainMaterial') {
          this.showTerrainSubmenu()
          return
        }
        if (type === 'terrainContour') {
          this.showTerrainContourSubmenu()
          return
        }
        if (type === 'prop') {
          this.showPropSubmenu()
          return
        }
        if (type === 'environment') {
          this.showEnvironmentSubmenu()
          return
        }
        if (type) {
          this.setObjectTypeHighlight(type)
          this.ctx.onObjectTypeSelected(type)
        }
      })
    })
    this.bindMenuItems(this.editorObjectItems, EditorSubmenuMode.Object)

    this.terrainSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const brushId = item.dataset.brush as TerrainBrushId | undefined
        if (brushId) {
          this.ctx.onTerrainBrushSelected(brushId)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.terrainSubmenuItems, EditorSubmenuMode.Terrain)

    this.terrainFillSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.hideTerrainFillSubmenu()
          return
        }
        const materialId = item.dataset.fillMaterial as
          | TerrainMaterialId
          | undefined
        if (materialId) {
          this.ctx.onTerrainFillSelected(materialId)
          this.hideTerrainFillSubmenu()
        }
      })
    })
    this.bindMenuItems(
      this.terrainFillSubmenuItems,
      EditorSubmenuMode.TerrainFill
    )

    this.terrainContourSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const contourMode = item.dataset.contourMode
        if (contourMode === 'draw') {
          this.ctx.onTerrainContourDrawSelected()
          this.hideObjectTypeMenu()
          return
        }
        const shape = item.dataset.shape as GroundShapeType | undefined
        if (shape) {
          this.ctx.onTerrainContourShapeSelected(shape)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(
      this.terrainContourSubmenuItems,
      EditorSubmenuMode.TerrainContour
    )

    this.weaponItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const weaponType = item.dataset.weapon as WeaponType | undefined
        const category = item.dataset.category as WeaponCategory | undefined
        const sizeStr = item.dataset.size
        const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined
        if (weaponType && category) {
          this.ctx.onWeaponSelected(weaponType, category, size)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.weaponItems, EditorSubmenuMode.Weapon)

    this.npcSubmenu.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const editBtn = target.closest<HTMLButtonElement>(
        '.editor-submenu-template-edit'
      )
      if (editBtn && this.npcSubmenu.contains(editBtn)) {
        const templateId = editBtn.dataset.npcTemplateId
        if (templateId) {
          this.hideObjectTypeMenu()
          void this.ctx.onEditCustomNpcTemplate(templateId)
        }
        return
      }
      const item = target.closest<HTMLButtonElement>('.editor-submenu-item')
      if (!item || !this.npcSubmenu.contains(item)) {
        return
      }
      const action = item.dataset.action
      if (action === 'back') {
        this.handleMenuBack()
        return
      }
      const npcType = item.dataset.npc as NpcType | undefined
      if (npcType) {
        this.ctx.onNpcSelected(npcType)
        this.hideObjectTypeMenu()
        return
      }
      const templateId = item.dataset.npcTemplateId
      if (templateId) {
        this.ctx.onCustomNpcTemplateSelected(templateId)
        this.hideObjectTypeMenu()
      }
    })
    this.bindMenuItems(this.npcSubmenuItems, EditorSubmenuMode.Npc)

    this.npcTemplateAddBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void this.ctx.onCreateCustomNpcTemplate()
    })

    this.propSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const weaponType = item.dataset.weapon as WeaponType | undefined
        const category = item.dataset.category as WeaponCategory | undefined
        if (weaponType && category) {
          this.ctx.onWeaponSelected(weaponType, category)
          this.hideObjectTypeMenu()
          return
        }
        const sunPickup = item.dataset.sunpickup
        if (sunPickup) {
          this.ctx.onSunPickupSelected(sunPickup === 'large')
          this.hideObjectTypeMenu()
          return
        }
        if (item.dataset.exporb === '1') {
          this.ctx.onExpOrbSelected()
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(this.propSubmenuItems, EditorSubmenuMode.Prop)

    this.propSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.environmentSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleMenuBack()
          return
        }
        const envType = item.dataset.env as MapEnvironmentObjectType | undefined
        if (envType) {
          this.ctx.onEnvironmentObjectSelected(envType)
          this.hideObjectTypeMenu()
        }
      })
    })
    this.bindMenuItems(
      this.environmentSubmenuItems,
      EditorSubmenuMode.Environment
    )

    this.environmentSubmenu.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const item = target.closest<HTMLButtonElement>('.editor-submenu-item')
      if (!item || !this.environmentSubmenu.contains(item)) {
        return
      }
      const assetId = item.dataset.environmentAssetId
      if (assetId) {
        void this.ctx.onCustomEnvironmentAssetSelected(assetId)
        this.hideObjectTypeMenu()
      }
    })

    this.environmentAssetAddBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void this.ctx.onCreateCustomEnvironmentAsset()
    })

    this.environmentSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.panelMenuAddBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.ctx.onPanelMenuAdd()
    })

    this.panelMenuPasteBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.panelMenuPasteBtn.disabled) {
        return
      }
      this.ctx.onPanelMenuPaste()
    })

    this.panelMenuMapSettingsBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.ctx.onPanelMenuMapSettings()
    })

    this.panelMenuAssetManagerBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.ctx.onPanelMenuAssetManager()
    })

    this.panelMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.objectTypeMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.terrainSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.terrainFillSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.terrainContourSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.weaponMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.npcSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
  }

  private bindMenuItems(
    items: ArrayLike<HTMLButtonElement>,
    mode: EditorSubmenuMode
  ) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      item.dataset.menuIndex = String(i)
      item.dataset.menuMode = mode
      if (item.dataset.menuHoverBound !== '1') {
        item.dataset.menuHoverBound = '1'
        item.addEventListener('mouseenter', this.boundHandleMenuItemMouseEnter)
      }
    }
  }

  private handleMenuItemMouseEnter(event: Event) {
    if (this.menuMode === EditorSubmenuMode.None) {
      return
    }
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) {
      return
    }
    const mode = target.dataset.menuMode as EditorSubmenuMode | undefined
    if (!mode || mode !== this.menuMode) {
      return
    }
    const index = Number.parseInt(target.dataset.menuIndex ?? '', 10)
    if (!Number.isFinite(index)) {
      return
    }
    this.menuNavigator.setSelectedIndex(index)
  }

  private handleMenuBack() {
    if (this.menuMode === EditorSubmenuMode.Terrain) {
      this.hideTerrainSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.TerrainContour) {
      this.hideTerrainContourSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.TerrainFill) {
      this.hideTerrainFillSubmenu()
      return
    }
    if (this.menuMode === EditorSubmenuMode.Weapon) {
      this.hideWeaponMenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Npc) {
      this.hideNpcSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Prop) {
      this.hidePropSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Environment) {
      this.hideEnvironmentSubmenu()
      if (this.isObjectTypeMenuVisible()) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.menuMode === EditorSubmenuMode.Object) {
      this.hideObjectTypeMenu()
      this.menuNavigator.setMode(EditorSubmenuMode.None, false)
    }
  }

  getMenuNavigator(): EditorMenuNavigator {
    return this.menuNavigator
  }

  getMenuMode(): EditorSubmenuMode {
    return this.menuMode
  }

  getMenuSelectedIndex(): number {
    return this.menuSelectedIndex
  }

  getPanelMenuPosition(): { x: number; y: number } {
    return { x: this.panelMenuX, y: this.panelMenuY }
  }

  updateLocalization() {
    this.panelMenuAddBtn.textContent = localizer.t('editor_panel_add_object')
    this.panelMenuPasteBtn.textContent = localizer.t('editor_object_menu_paste')
    this.panelMenuMapSettingsBtn.textContent = localizer.t(
      'editor_map_settings'
    )
    this.panelMenuAssetManagerBtn.textContent = localizer.t(
      'editor_asset_manager'
    )

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type
      if (type) {
        item.textContent = localizer.t(`editor_object_${type}`)
      }
    })

    this.terrainSubmenuItems.forEach((item) => {
      const brush = item.dataset.brush
      if (brush) {
        item.textContent = localizer.t(`editor_terrain_brush_${brush}`)
      }
    })

    this.terrainContourSubmenuItems.forEach((item) => {
      const contourMode = item.dataset.contourMode
      if (contourMode === 'draw') {
        item.textContent = localizer.t('editor_terrain_contour_draw')
        return
      }
      const shape = item.dataset.shape
      if (shape) {
        item.textContent = localizer.t(`editor_ground_shape_${shape}`)
      }
    })

    this.terrainFillSubmenuItems.forEach((item) => {
      const materialId = item.dataset.fillMaterial
      if (materialId) {
        item.textContent = localizer.t(`editor_terrain_brush_${materialId}`)
      }
    })

    this.weaponGroupTitles.forEach((title) => {
      const category = title.dataset.categoryTitle
      if (category) {
        title.textContent = localizer.t(`editor_weapon_category_${category}`)
      }
    })

    this.weaponItems.forEach((item) => {
      const weapon = item.dataset.weapon
      const sizeStr = item.dataset.size
      if (weapon && sizeStr) {
        this.setWeaponMenuItemContent(
          item,
          localizer.t(`editor_weapon_size_${weapon}_${sizeStr}`)
        )
      } else if (weapon) {
        this.setWeaponMenuItemContent(
          item,
          localizer.t(`editor_weapon_${weapon}`)
        )
      }
    })

    this.npcCustomTemplateTitle.textContent = localizer.t(
      'editor_npc_template_group'
    )
    this.renderCustomNpcTemplateItems()
    this.environmentCustomAssetTitle.textContent = localizer.t(
      'editor_environment_asset_group'
    )
    this.environmentAssetAddBtn.title = localizer.t(
      'editor_environment_asset_create'
    )
    this.renderCustomEnvironmentAssetItems()

    this.propSubmenuItems.forEach((item) => {
      const weapon = item.dataset.weapon
      const sunpickup = item.dataset.sunpickup
      const isExpOrb = item.dataset.exporb === '1'
      if (weapon) {
        this.setWeaponMenuItemContent(
          item,
          localizer.t(`editor_weapon_${weapon}`)
        )
      } else if (sunpickup) {
        item.textContent = localizer.t(`editor_prop_${sunpickup}`)
      } else if (isExpOrb) {
        item.textContent = localizer.t('editor_prop_expOrb')
      }
    })

    this.environmentSubmenuItems.forEach((item) => {
      const envType = item.dataset.env
      if (envType) {
        item.textContent = localizer.t(`editor_env_${envType}`)
      }
    })

    this.objectTypeMenuBackBtn.textContent = localizer.t('menu_back')
    this.terrainSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.terrainContourSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.terrainFillSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.weaponMenuBackBtn.textContent = localizer.t('menu_back')
    this.npcSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.propSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.environmentSubmenuBackBtn.textContent = localizer.t('menu_back')
  }

  private setWeaponMenuItemContent(
    item: HTMLButtonElement,
    label: string
  ): void {
    const weaponType = item.dataset.weapon as WeaponType | undefined
    const category = item.dataset.category as WeaponCategory | undefined
    if (!weaponType) {
      item.classList.remove('editor-submenu-item-weapon')
      item.textContent = label
      return
    }

    if (weaponType === 'hook' || category === 'item') {
      item.classList.remove('editor-submenu-item-weapon')
      item.textContent = label
      return
    }

    item.textContent = ''
    item.classList.add('editor-submenu-item-weapon')

    const icon = document.createElement('canvas')
    icon.width = 44
    icon.height = 18
    icon.className = 'editor-submenu-item-icon'
    this.renderWeaponMenuIcon(icon, weaponType, item.dataset.size)
    item.appendChild(icon)

    const text = document.createElement('span')
    text.className = 'editor-submenu-item-label'
    text.textContent = label
    item.appendChild(text)
  }

  private renderWeaponMenuIcon(
    canvas: HTMLCanvasElement,
    weaponType: WeaponType,
    sizeValue?: string
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const template = WEAPON_DEFAULT_DATA[weaponType]
    const parsedSize = sizeValue ? Number.parseInt(sizeValue, 10) : NaN
    const sizeLevel =
      Number.isFinite(parsedSize) && parsedSize > 0
        ? parsedSize
        : template.sizeLevel
    const renderType = this.getWeaponRenderType(weaponType)
    const isBow = weaponType === 'bow'
    const dims = computeWeaponRenderDimensions(
      template,
      sizeLevel,
      this.weaponPreviewPixelsPerMeter,
      isBow
    )

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(Math.round(canvas.width / 2), Math.round(canvas.height / 2))
    ctx.rotate(getWeaponGroundRotationRad(weaponType))

    const maxWidth = canvas.width - 6
    const maxHeight = canvas.height - 4
    const scaleX = Math.max(1, Math.floor((maxWidth * 1000) / dims.widthPx))
    const baseHeight = isBow ? dims.boundingHeightPx : dims.heightPx
    const scaleY = Math.max(1, Math.floor((maxHeight * 1000) / baseHeight))
    const scale = Math.min(scaleX, scaleY)
    const drawWidth = Math.max(1, Math.floor((dims.widthPx * scale) / 1000))
    const drawHeight = Math.max(1, Math.floor((dims.heightPx * scale) / 1000))

    renderWeapon(ctx, renderType, drawWidth, drawHeight, '#b4bdc7')
    ctx.restore()
  }

  private getWeaponRenderType(
    weaponType: WeaponType
  ): 'sword' | 'spear' | 'hammer' | 'bow' | 'grape' | 'hook' | 'bomb' {
    if (weaponType === 'hook') {
      return 'hook'
    }
    if (weaponType === 'bow') {
      return 'bow'
    }
    if (weaponType === 'grape') {
      return 'grape'
    }
    if (weaponType === 'bomb') {
      return 'bomb'
    }
    if (weaponType === 'hammer') {
      return 'hammer'
    }
    if (weaponType === 'spear') {
      return 'spear'
    }
    return 'sword'
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const items = this.getMenuItems(this.menuMode)
    if (this.menuMode === EditorSubmenuMode.None) {
      return false
    }
    if (items.length === 0) {
      return false
    }
    const key = event.key
    if (key === 'ArrowUp' || key === 'w') {
      event.preventDefault()
      const nextIndex = this.menuNavigator.findNextSelectableIndex(
        items,
        this.menuSelectedIndex,
        -1
      )
      this.menuNavigator.setSelectedIndex(nextIndex)
      return true
    }
    if (key === 'ArrowDown' || key === 's') {
      event.preventDefault()
      const nextIndex = this.menuNavigator.findNextSelectableIndex(
        items,
        this.menuSelectedIndex,
        1
      )
      this.menuNavigator.setSelectedIndex(nextIndex)
      return true
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      const item = items[this.menuSelectedIndex]
      if (item && !item.disabled) {
        item.click()
      }
      return true
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.handleMenuBack()
      return true
    }
    return false
  }

  hideAll() {
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideTerrainSubmenu()
    this.hideTerrainContourSubmenu()
    this.hideTerrainFillSubmenu()
    this.hideWeaponMenu()
    this.hideNpcSubmenu()
    this.hidePropSubmenu()
    this.hideEnvironmentSubmenu()
  }

  hideAllSubmenus() {
    this.hideTerrainSubmenu()
    this.hideTerrainContourSubmenu()
    this.hideTerrainFillSubmenu()
    this.hideWeaponMenu()
    this.hideNpcSubmenu()
    this.hidePropSubmenu()
    this.hideEnvironmentSubmenu()
  }

  isAnyMenuVisible(): boolean {
    return (
      this.panelMenu.classList.contains('is-visible') ||
      this.objectTypeMenu.classList.contains('is-visible') ||
      this.terrainSubmenu.classList.contains('is-visible') ||
      this.terrainContourSubmenu.classList.contains('is-visible') ||
      this.terrainFillSubmenu.classList.contains('is-visible') ||
      this.weaponMenu.classList.contains('is-visible') ||
      this.npcSubmenu.classList.contains('is-visible') ||
      this.propSubmenu.classList.contains('is-visible') ||
      this.environmentSubmenu.classList.contains('is-visible')
    )
  }

  containsTarget(target: Node): boolean {
    return (
      this.panelMenu.contains(target) ||
      this.objectTypeMenu.contains(target) ||
      this.terrainSubmenu.contains(target) ||
      this.terrainContourSubmenu.contains(target) ||
      this.terrainFillSubmenu.contains(target) ||
      this.weaponMenu.contains(target) ||
      this.npcSubmenu.contains(target) ||
      this.propSubmenu.contains(target) ||
      this.environmentSubmenu.contains(target)
    )
  }

  showPanelMenu(clientX: number, clientY: number) {
    this.hideTerrainContourSubmenu()
    this.hideNpcSubmenu()
    this.hideTerrainFillSubmenu()
    this.hideObjectTypeMenu()
    this.panelMenuX = clientX
    this.panelMenuY = clientY
    this.panelMenu.classList.add('is-visible')
    this.adjustMenuPosition(this.panelMenu, clientX, clientY)
    if (DEBUG_EDITOR_MENU) {
      // console.log('[editor] show panel menu', { clientX, clientY })
    }
  }

  setPanelMenuPasteEnabled(enabled: boolean) {
    this.panelMenuPasteBtn.disabled = !enabled
  }

  hidePanelMenu() {
    if (!this.panelMenu.classList.contains('is-visible')) {
      return
    }
    this.panelMenu.classList.remove('is-visible')
    if (DEBUG_EDITOR_MENU) {
      // console.log('[editor] hide panel menu')
    }
  }

  showObjectTypeMenu(clientX: number, clientY: number) {
    this.hidePanelMenu()
    this.hideTerrainSubmenu()
    this.hideTerrainContourSubmenu()
    this.hideTerrainFillSubmenu()
    this.hideNpcSubmenu()
    this.setObjectTypeHighlight(null)
    this.objectTypeMenuX = clientX
    this.objectTypeMenuY = clientY

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type as EditorObjectMenuType | undefined
      if (!type) {
        return
      }
      if (type === ObjectType.Player || type === ObjectType.Camera) {
        if (this.ctx.hasObjectOfType(type)) {
          item.disabled = true
          item.classList.add('disabled')
        } else {
          item.disabled = false
          item.classList.remove('disabled')
        }
      }
    })

    this.objectTypeMenu.classList.add('is-visible')
    this.adjustMenuPosition(this.objectTypeMenu, clientX, clientY)
    this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
  }

  hideObjectTypeMenu() {
    if (!this.objectTypeMenu.classList.contains('is-visible')) {
      return
    }
    this.objectTypeMenu.classList.remove('is-visible')
    this.setObjectTypeHighlight(null)
    this.hideTerrainSubmenu()
    this.hideTerrainContourSubmenu()
    this.hideTerrainFillSubmenu()
    this.hideWeaponMenu()
    this.hideNpcSubmenu()
    this.hidePropSubmenu()
    this.hideEnvironmentSubmenu()
    this.menuNavigator.setMode(EditorSubmenuMode.None, false)
  }

  isObjectTypeMenuVisible(): boolean {
    return this.objectTypeMenu.classList.contains('is-visible')
  }

  showTerrainSubmenu() {
    this.hideSiblingSubmenus(EditorSubmenuMode.Terrain)
    this.positionTerrainSubmenu()
    this.terrainSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Terrain, true)
    this.setObjectTypeHighlight('terrainMaterial')
  }

  hideTerrainSubmenu() {
    this.terrainSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Terrain) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showTerrainFillSubmenu(clientX: number, clientY: number) {
    this.hideSiblingSubmenus(EditorSubmenuMode.TerrainFill)
    this.terrainFillSubmenu.classList.add('is-visible')
    this.adjustMenuPosition(this.terrainFillSubmenu, clientX, clientY)
    this.menuNavigator.setMode(EditorSubmenuMode.TerrainFill, true)
  }

  hideTerrainFillSubmenu() {
    this.terrainFillSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.TerrainFill) {
      this.menuNavigator.setMode(EditorSubmenuMode.None, false)
    }
  }

  showTerrainContourSubmenu() {
    this.hideSiblingSubmenus(EditorSubmenuMode.TerrainContour)
    this.positionTerrainContourSubmenu()
    this.terrainContourSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.TerrainContour, true)
    this.setObjectTypeHighlight('terrainContour')
  }

  hideTerrainContourSubmenu() {
    this.terrainContourSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.TerrainContour) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showWeaponMenu() {
    this.hideSiblingSubmenus(EditorSubmenuMode.Weapon)
    this.positionWeaponMenu()
    this.weaponMenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Weapon, true)
    this.setObjectTypeHighlight(ObjectType.Weapon)
  }

  hideWeaponMenu() {
    this.weaponMenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Weapon) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showNpcSubmenu() {
    this.renderCustomNpcTemplateItems()
    this.hideSiblingSubmenus(EditorSubmenuMode.Npc)
    this.positionNpcSubmenu()
    this.npcSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Npc, true)
    this.setObjectTypeHighlight(ObjectType.Npc)
  }

  hideNpcSubmenu() {
    this.npcSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Npc) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  showPropSubmenu() {
    const hasHook = this.ctx.hasWeaponType('hook')
    this.propSubmenuItems.forEach((item) => {
      if (item.dataset.weapon === 'hook') {
        if (hasHook) {
          item.disabled = true
          item.classList.add('disabled')
        } else {
          item.disabled = false
          item.classList.remove('disabled')
        }
      }
    })
    this.hideSiblingSubmenus(EditorSubmenuMode.Prop)
    this.positionPropSubmenu()
    this.propSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Prop, true)
    this.setObjectTypeHighlight('prop')
  }

  hidePropSubmenu() {
    this.propSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Prop) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  positionPropSubmenu() {
    this.positionShapeSubmenu(this.propMenuItem, this.propSubmenu)
  }

  showEnvironmentSubmenu() {
    this.renderCustomEnvironmentAssetItems()
    this.hideSiblingSubmenus(EditorSubmenuMode.Environment)
    this.positionEnvironmentSubmenu()
    this.environmentSubmenu.classList.add('is-visible')
    this.menuNavigator.setMode(EditorSubmenuMode.Environment, true)
    this.setObjectTypeHighlight('environment')
  }

  hideEnvironmentSubmenu() {
    this.environmentSubmenu.classList.remove('is-visible')
    if (this.menuMode === EditorSubmenuMode.Environment) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.menuNavigator.setMode(EditorSubmenuMode.Object, true)
      } else {
        this.menuNavigator.setMode(EditorSubmenuMode.None, false)
      }
    }
  }

  positionEnvironmentSubmenu() {
    this.positionShapeSubmenu(this.environmentMenuItem, this.environmentSubmenu)
  }

  positionTerrainSubmenu() {
    this.positionShapeSubmenu(this.terrainMenuItem, this.terrainSubmenu)
  }

  positionTerrainContourSubmenu() {
    this.positionShapeSubmenu(
      this.terrainContourMenuItem,
      this.terrainContourSubmenu
    )
  }

  positionWeaponMenu() {
    this.positionShapeSubmenu(this.weaponMenuItem, this.weaponMenu)
  }

  positionNpcSubmenu() {
    this.positionShapeSubmenu(this.npcMenuItem, this.npcSubmenu)
  }

  handleWindowResize() {
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.terrainSubmenu.classList.contains('is-visible')
    ) {
      this.positionTerrainSubmenu()
    }
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.terrainContourSubmenu.classList.contains('is-visible')
    ) {
      this.positionTerrainContourSubmenu()
    }
  }

  private positionShapeSubmenu(
    menuItem: HTMLButtonElement,
    submenu: HTMLDivElement
  ) {
    const menuRect = this.objectTypeMenu.getBoundingClientRect()
    const itemRect = menuItem.getBoundingClientRect()
    const x = menuRect.right + 6
    const y = itemRect.top
    this.adjustMenuPosition(submenu, x, y)
  }

  private adjustMenuPosition(menu: HTMLElement, x: number, y: number) {
    const wasVisible = menu.classList.contains('is-visible')
    if (!wasVisible) {
      menu.style.visibility = 'hidden'
      menu.classList.add('is-visible')
    }

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    const rect = menu.getBoundingClientRect()
    const viewportRect = this.editorWorkspace.getBoundingClientRect()

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

  private hideSiblingSubmenus(exclude: EditorSubmenuMode): void {
    if (exclude !== EditorSubmenuMode.Terrain) {
      this.hideTerrainSubmenu()
    }
    if (exclude !== EditorSubmenuMode.TerrainContour) {
      this.hideTerrainContourSubmenu()
    }
    if (exclude !== EditorSubmenuMode.TerrainFill) {
      this.hideTerrainFillSubmenu()
    }
    if (exclude !== EditorSubmenuMode.Weapon) {
      this.hideWeaponMenu()
    }
    if (exclude !== EditorSubmenuMode.Npc) {
      this.hideNpcSubmenu()
    }
    if (exclude !== EditorSubmenuMode.Prop) {
      this.hidePropSubmenu()
    }
    if (exclude !== EditorSubmenuMode.Environment) {
      this.hideEnvironmentSubmenu()
    }
  }

  private setObjectTypeHighlight(type: EditorObjectMenuType | null) {
    this.editorObjectItems.forEach((item) => {
      const itemType = item.dataset.type as EditorObjectMenuType | undefined
      if (type && itemType === type) {
        item.classList.add('is-selected')
      } else {
        item.classList.remove('is-selected')
      }
    })
  }

  refreshCustomNpcTemplates() {
    this.renderCustomNpcTemplateItems()
  }

  refreshCustomEnvironmentAssets() {
    this.renderCustomEnvironmentAssetItems()
  }

  private renderCustomNpcTemplateItems() {
    this.npcCustomTemplateList.innerHTML = ''
    const templates = this.ctx.getCustomNpcTemplates()
    for (let i = 0; i < templates.length; i++) {
      const template = templates[i]
      const row = document.createElement('div')
      row.className = 'editor-submenu-template-row'

      const item = document.createElement('button')
      item.className = 'editor-submenu-item'
      item.dataset.npcTemplateId = template.id
      item.textContent = template.name

      const editBtn = document.createElement('button')
      editBtn.className = 'editor-submenu-template-edit'
      editBtn.dataset.npcTemplateId = template.id
      editBtn.type = 'button'
      editBtn.textContent = '✎'
      editBtn.title = localizer.t('editor_npc_template_edit')

      row.appendChild(item)
      row.appendChild(editBtn)
      this.npcCustomTemplateList.appendChild(row)
    }

    const npcItems = this.npcSubmenu.querySelectorAll<HTMLButtonElement>(
      '.editor-submenu-item'
    )
    this.npcSubmenuItems = Array.from(npcItems)
    this.npcSubmenuItems.forEach((item) => {
      const npc = item.dataset.npc
      if (npc) {
        item.textContent = localizer.t(`editor_enemy_${npc}`)
      }
    })
    this.bindMenuItems(this.npcSubmenuItems, EditorSubmenuMode.Npc)
    if (this.menuMode === EditorSubmenuMode.Npc) {
      this.menuNavigator.setMode(EditorSubmenuMode.Npc, false)
    }
  }

  private renderCustomEnvironmentAssetItems() {
    this.environmentCustomAssetList.innerHTML = ''
    const assets = this.ctx.getCustomEnvironmentAssets()
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]
      const item = document.createElement('button')
      item.className = 'editor-submenu-item'
      item.dataset.environmentAssetId = asset.id
      item.textContent = asset.name
      this.environmentCustomAssetList.appendChild(item)
    }

    const environmentItems =
      this.environmentSubmenu.querySelectorAll<HTMLButtonElement>(
        '.editor-submenu-item'
      )
    this.environmentSubmenuItems = Array.from(environmentItems)
    this.environmentSubmenuItems.forEach((item) => {
      const envType = item.dataset.env
      if (envType) {
        item.textContent = localizer.t(`editor_env_${envType}`)
      }
    })
    this.bindMenuItems(
      this.environmentSubmenuItems,
      EditorSubmenuMode.Environment
    )
    if (this.menuMode === EditorSubmenuMode.Environment) {
      this.menuNavigator.setMode(EditorSubmenuMode.Environment, false)
    }
  }
}
