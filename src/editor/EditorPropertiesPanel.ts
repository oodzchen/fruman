import * as fabric from 'fabric'

import type { DialogManager } from '../DialogManager'
import { localizer } from '../Localizer'
import {
  getCharacterBodyColor,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
} from '../characterBodyProfile'
import { CHARACTER_DEFAULT_DATA, WEAPON_DEFAULT_DATA } from '../constants'
import {
  type AttackMovesetOwner,
  NORMAL_ATTACK_MOVESET_OPTIONS,
  NPC_ATTACK_MOVE_OPTIONS,
  buildDefaultNpcAttackMoves,
  getDefaultAttackMovesetIdForWeaponType,
  getDefaultNormalAttackMovesetId,
  isMovesetCompatibleWithWeaponType,
  normalizeNpcAttackMoves,
} from '../ecs/AttackMoveRegistry'
import { Faction } from '../ecs/Component'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import type {
  EditorMapData,
  MapCharacterBodyProfile,
  MapNpcDropItem,
  MapNpcTemplate,
  MapNpcWeapon,
  MapSettings,
} from '../editorMapTypes'
import { DEFAULT_MAP_TIME_PHASE, MAP_TIME_PHASE_IDS } from '../editorMapTypes'
import {
  MAX_NPC_DROP_COUNT,
  NPC_DROP_ITEM_TYPES,
  buildDefaultNpcDropList,
  normalizeNpcDropChance,
  normalizeNpcDropCount,
  normalizeNpcDropItemType,
  normalizeNpcDropList,
} from '../npcDropUtils'
import { formatRenderLayerLabel } from '../renderLayers'
import {
  HUD_SLOT_SIZE,
  HUD_SLOT_SPACING,
  drawHudWeaponSlot,
} from '../renderer/HudWeaponSlotRenderer'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type {
  NormalAttackMovesetId,
  NpcAttackMove,
  NpcAttackMoveId,
  NpcDetectionRangeLevel,
  NpcDropItemType,
  NpcPatrolMode,
  WeaponType,
} from '../types'
import {
  getDefaultNpcAmmoForWeaponType,
  getDefaultPlayerAmmoForWeaponType,
  getWeaponGroundRotationRad,
  isAmmoLimitedWeaponType,
  isSecondaryWeaponType,
  resolveWeaponStatsForSize,
} from '../weaponTypeUtils'
import { EditorCharacterBodyDrawer } from './EditorCharacterBodyDrawer'
import type { EditorObjectFactory } from './EditorObjectFactory'
import {
  computeWeaponRenderDimensions,
  renderNpcPreviewToContext,
} from './EditorRenderUtils'
import { EditorUIHelper } from './EditorUIHelper'
import type {
  EditorObjectData,
  NpcMarker,
  NpcMarkerData,
  PlayerMarker,
  PlayerMarkerData,
  WeaponMarker,
  WeaponMarkerData,
} from './types'

type CharacterWeaponBinding = {
  label: string
  slot: 'main' | 'secondary'
  options: Array<{ label: string; value: string }>
  defaultBowAmmo: number
  getWeaponType: () => WeaponType | undefined
  setWeaponType: (weaponType: WeaponType | undefined) => void
  getWeaponMarker: () => WeaponMarker | undefined
  setWeaponMarker: (marker: WeaponMarker | undefined) => void
  ensureWeaponMarker: (weaponType: WeaponType) => WeaponMarker | null
}

type CharacterDialogOptions = {
  title: string
  marker?: NpcMarker | PlayerMarker
  data: {
    radius: number
    bodyHeight: number
    bodyProfile?: MapCharacterBodyProfile
    moveSpeed?: number
    attackDesire?: number
    parryProficiency?: number
    initialPatrolMode?: NpcPatrolMode
    detectionRangeLevel?: NpcDetectionRangeLevel
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    facing: number
    initialNormalMovesetId: NormalAttackMovesetId
    attackMoves?: NpcAttackMove[]
    debugNoDamage: boolean
    debugNoDeath: boolean
    redTapeEnabled?: boolean
    retreatEnabled?: boolean
    retreatDelaySec?: number
    canBeFollower?: boolean
    factionId: string
    npcFactions: string[]
    allyFactions: string[]
    drops?: MapNpcDropItem[]
    mainWeaponConfig?: MapNpcWeapon
    secondaryWeaponConfig?: MapNpcWeapon
  }
  attackMovesetOwner: AttackMovesetOwner
  showMoveSpeed: boolean
  showAttackDesire: boolean
  showParry: boolean
  showPatrol: boolean
  showRedTape?: boolean
  showRetreat?: boolean
  showDetectionRange?: boolean
  showCanBeFollower?: boolean
  showDrops?: boolean
  showAttackMoves?: boolean
  confirmLabel?: string
  useMapSnapshot?: boolean
  captureHistoryOnCommit?: boolean
  weaponBindings: CharacterWeaponBinding[]
  updateMarkerVisual: (
    marker: NpcMarker | PlayerMarker,
    radiusMeters: number,
    bodyHeightMeters: number,
    color: string,
    facing: number
  ) => void
  onCommit: (values: {
    radius: number
    bodyHeight: number
    bodyProfile?: MapCharacterBodyProfile
    moveSpeed?: number
    attackDesire?: number
    parryProficiency?: number
    initialPatrolMode?: NpcPatrolMode
    detectionRangeLevel?: NpcDetectionRangeLevel
    facing: number
    initialNormalMovesetId: NormalAttackMovesetId
    attackMoves?: NpcAttackMove[]
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    debugNoDamage: boolean
    debugNoDeath: boolean
    redTapeEnabled?: boolean
    retreatEnabled?: boolean
    retreatDelaySec?: number
    canBeFollower?: boolean
    factionId: string
    npcFactions: string[]
    allyFactions: string[]
    drops?: MapNpcDropItem[]
    mainWeaponType?: WeaponType
    mainWeaponConfig?: MapNpcWeapon
    mainWeaponMarker?: WeaponMarker
    secondaryWeaponType?: WeaponType
    secondaryWeaponConfig?: MapNpcWeapon
    secondaryWeaponMarker?: WeaponMarker
  }) => void
}

type WeaponPropertiesDialogOptions = {
  useMapSnapshot?: boolean
  captureHistoryOnCommit?: boolean
}

export interface EditorPropertiesPanelContext {
  dialogManager: DialogManager
  getFabricCanvas: () => fabric.Canvas | null
  weaponMarkerMap: Map<fabric.Object, WeaponMarkerData>
  npcMarkerMap: Map<fabric.Object, NpcMarkerData>
  playerMarkerData: () => PlayerMarkerData | null
  editorObjectMap: Map<fabric.Object, EditorObjectData>
  objectFactory: EditorObjectFactory
  requestRender: () => void
  getMapSnapshot: () => EditorMapData
  getFactions: () => string[]
  addFaction: (id: string) => void
  applyMapSnapshot: (data: EditorMapData) => void
  onHistoryCapture: () => void
  getOrCreateNpcWeaponMarker: (
    npcData: NpcMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ) => WeaponMarker | null
  getOrCreatePlayerWeaponMarker: (
    playerData: PlayerMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ) => WeaponMarker | null
  updateNpcMarkerVisual: (
    marker: NpcMarker,
    radiusMeters: number,
    bodyHeightMeters: number,
    color: string,
    facing: number
  ) => void
  updatePlayerMarkerVisual: (
    marker: PlayerMarker,
    radiusMeters: number,
    bodyHeightMeters: number,
    color: string,
    facing: number
  ) => void
  updateWeaponMarkerVisual: (marker: WeaponMarker, sizeLevel: number) => void
  getAvailableRenderLayers: () => number[]
  getCommonRenderLayer: (target: fabric.Object) => number
  setCommonRenderLayer: (
    target: fabric.Object,
    renderLayer: number | undefined
  ) => boolean
  getTerrainStraightEdge: (target: fabric.Object) => boolean | null
  setTerrainStraightEdge: (
    target: fabric.Object,
    straightEdge: boolean
  ) => boolean
}

export class EditorPropertiesPanel {
  private context: EditorPropertiesPanelContext
  private bodyDrawer = new EditorCharacterBodyDrawer()
  private bodyTextureCache = new Map<string, HTMLImageElement>()

  constructor(context: EditorPropertiesPanelContext) {
    this.context = context
  }

  private getBodyTextureImage(
    profile: MapCharacterBodyProfile | undefined,
    onReady?: () => void
  ): HTMLImageElement | null {
    const textureDataUrl = profile?.textureDataUrl ?? profile?.surfaceDataUrl
    if (!textureDataUrl || textureDataUrl.length === 0) {
      return null
    }
    const cached = this.bodyTextureCache.get(textureDataUrl)
    if (cached) {
      if (onReady && !cached.complete) {
        cached.addEventListener('load', onReady, { once: true })
      }
      return cached
    }
    const image = new Image()
    if (onReady) {
      image.onload = onReady
    }
    image.src = textureDataUrl
    this.bodyTextureCache.set(textureDataUrl, image)
    return image
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

  private getNpcDropItemLabel(itemType: NpcDropItemType): string {
    if (itemType === 'sunPickupSmall') {
      return localizer.t('editor_prop_small')
    }
    if (itemType === 'sunPickupLarge') {
      return localizer.t('editor_prop_large')
    }
    if (itemType === 'expOrb') {
      return localizer.t('editor_prop_expOrb')
    }
    return localizer.t(`editor_weapon_${itemType}`)
  }

  private getNpcDropItemOptions(): Array<{ label: string; value: string }> {
    const options: Array<{ label: string; value: string }> = []
    for (let i = 0; i < NPC_DROP_ITEM_TYPES.length; i++) {
      const itemType = NPC_DROP_ITEM_TYPES[i]
      options.push({
        value: itemType,
        label: this.getNpcDropItemLabel(itemType),
      })
    }
    return options
  }

  private removeDetachedWeaponMarker(
    marker: WeaponMarker | undefined,
    trackedMarkers: WeaponMarker[]
  ) {
    if (!marker) {
      return
    }
    this.context.weaponMarkerMap.delete(marker)
    const index = trackedMarkers.indexOf(marker)
    if (index >= 0) {
      trackedMarkers.splice(index, 1)
    }
  }

  private serializeWeaponMarker(
    marker: WeaponMarker | undefined
  ): MapNpcWeapon | undefined {
    if (!marker) {
      return undefined
    }
    const data = this.context.weaponMarkerMap.get(marker)
    if (!data) {
      return undefined
    }
    return {
      weaponType: data.weaponType,
      sizeLevel: data.sizeLevel,
      attackDamage: data.attackDamage,
      postureDamage: data.postureDamage,
      toughnessDamage: data.toughnessDamage,
      bowAmmo: data.bowAmmo,
    }
  }

  private createDetachedWeaponMarker(
    weaponType: WeaponType,
    slot: 'main' | 'secondary',
    trackedMarkers: WeaponMarker[],
    initialData?: MapNpcWeapon
  ): WeaponMarker {
    const template = WEAPON_DEFAULT_DATA[weaponType]
    const sizeLevel = initialData?.sizeLevel ?? template.sizeLevel
    const resolvedStats = resolveWeaponStatsForSize(
      template,
      sizeLevel,
      initialData
        ? {
            attackDamage: initialData.attackDamage,
            postureDamage: initialData.postureDamage,
            toughnessDamage: initialData.toughnessDamage,
          }
        : undefined,
      true
    )
    const bowAmmoDefault = isAmmoLimitedWeaponType(weaponType)
      ? getDefaultNpcAmmoForWeaponType(weaponType)
      : undefined
    const marker = this.context.objectFactory.createWeaponMarker(
      weaponType,
      slot,
      sizeLevel,
      resolvedStats.attackDamage,
      resolvedStats.postureDamage,
      resolvedStats.toughnessDamage,
      initialData?.bowAmmo ?? bowAmmoDefault,
      template
    ) as WeaponMarker
    this.context.weaponMarkerMap.set(marker, {
      marker,
      weaponType,
      category: slot,
      sizeLevel,
      attackDamage: marker.attackDamage,
      postureDamage: marker.postureDamage,
      toughnessDamage: marker.toughnessDamage,
      bowAmmo: marker.bowAmmo,
    })
    trackedMarkers.push(marker)
    return marker
  }

  private async showCharacterPropertiesDialog(options: CharacterDialogOptions) {
    const baseSnapshot =
      options.useMapSnapshot === false ? null : this.context.getMapSnapshot()
    let committed = false

    return await new Promise<void>((resolve) => {
      const dialog = EditorUIHelper.createPropertiesDialog(options.title)

      const {
        leftPanel,
        footerPanel,
        previewCanvas,
        previewCtx,
        close,
        modal,
      } = dialog
      const finish = () => {
        close()
        resolve()
      }
      const weaponSlotsCanvas = EditorUIHelper.createPreviewCanvas({
        width: 160,
        height: 64,
      })
      weaponSlotsCanvas.style.marginTop = '12px'
      const weaponSlotsCtx = weaponSlotsCanvas.getContext('2d')
      const hasWeaponBindings = options.weaponBindings.length > 0

      // Tab bar
      const tabBar = document.createElement('div')
      tabBar.style.cssText =
        'display:flex;border-bottom:1px solid rgba(255,255,255,0.15);margin-bottom:8px;position:sticky;top:0;z-index:1;background:rgba(0,0,0,0.9);'

      const createTabBtn = (label: string, active: boolean) => {
        const btn = document.createElement('button')
        btn.textContent = label
        btn.style.cssText = [
          'font:inherit;cursor:pointer;border:none;outline:none;',
          'padding:6px 14px;background:transparent;color:rgba(255,255,255,0.6);',
          'border-bottom:2px solid transparent;margin-bottom:-1px;',
          active
            ? 'color:#fff;border-bottom-color:#fff;'
            : 'color:rgba(255,255,255,0.5);',
        ].join('')
        return btn
      }

      const tabBtnBasic = createTabBtn(localizer.t('editor_tab_basic'), true)
      const tabBtnAppearance = createTabBtn(
        localizer.t('editor_tab_appearance'),
        false
      )
      const tabBtnEquipment = hasWeaponBindings
        ? createTabBtn(localizer.t('editor_tab_equipment'), false)
        : null
      tabBar.appendChild(tabBtnBasic)
      tabBar.appendChild(tabBtnAppearance)
      if (tabBtnEquipment) {
        tabBar.appendChild(tabBtnEquipment)
      }
      leftPanel.appendChild(tabBar)

      const basicPanel = document.createElement('div')
      const appearancePanel = document.createElement('div')
      const equipmentPanel = document.createElement('div')
      appearancePanel.style.display = 'none'
      equipmentPanel.style.display = 'none'
      leftPanel.appendChild(basicPanel)
      leftPanel.appendChild(appearancePanel)
      leftPanel.appendChild(equipmentPanel)

      const updateTabButtonState = (
        button: HTMLButtonElement | null,
        active: boolean
      ) => {
        if (!button) {
          return
        }
        button.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)'
        button.style.borderBottomColor = active ? '#fff' : 'transparent'
      }

      const switchTab = (tab: 'basic' | 'appearance' | 'equipment') => {
        basicPanel.style.display = tab === 'basic' ? '' : 'none'
        appearancePanel.style.display = tab === 'appearance' ? '' : 'none'
        equipmentPanel.style.display = tab === 'equipment' ? '' : 'none'
        updateTabButtonState(tabBtnBasic, tab === 'basic')
        updateTabButtonState(tabBtnAppearance, tab === 'appearance')
        updateTabButtonState(tabBtnEquipment, tab === 'equipment')
      }
      tabBtnBasic.addEventListener('click', () => switchTab('basic'))
      tabBtnAppearance.addEventListener('click', () => switchTab('appearance'))
      tabBtnEquipment?.addEventListener('click', () => switchTab('equipment'))

      // === 基础 Tab ===

      // Move Speed
      let speedInput: HTMLInputElement | null = null
      if (options.showMoveSpeed) {
        const speedRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_move_speed')
        )
        speedInput = EditorUIHelper.createNumberInput({
          value: options.data.moveSpeed ?? 0,
          min: '0',
          step: '0.1',
        })
        speedRow.row.appendChild(speedInput)
        basicPanel.appendChild(speedRow.row)
      }

      // Attack Desire
      let desireInput: HTMLInputElement | null = null
      if (options.showAttackDesire) {
        const desireRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_attack_desire')
        )
        desireInput = EditorUIHelper.createNumberInput({
          value: options.data.attackDesire ?? 0,
          min: '0',
          max: '100',
          step: '1',
        })
        desireRow.row.appendChild(desireInput)
        basicPanel.appendChild(desireRow.row)
      }

      // Parry Proficiency
      let parryInput: HTMLInputElement | null = null
      if (options.showParry) {
        const parryRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_parry')
        )
        parryInput = EditorUIHelper.createNumberInput({
          value: options.data.parryProficiency ?? 0,
          min: '0',
          max: '100',
          step: '1',
        })
        parryRow.row.appendChild(parryInput)
        basicPanel.appendChild(parryRow.row)
      }

      // Patrol Mode
      let patrolSelect: HTMLSelectElement | null = null
      if (options.showPatrol) {
        const patrolRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_patrol_mode')
        )
        const patrolModes: NpcPatrolMode[] = ['patrol', 'guard']
        patrolSelect = EditorUIHelper.createSelect({
          options: patrolModes.map((mode) => ({
            value: mode,
            label: localizer.t(`editor_enemy_patrol_${mode}`),
          })),
          selected: options.data.initialPatrolMode,
        })
        patrolRow.row.appendChild(patrolSelect)
        basicPanel.appendChild(patrolRow.row)
      }

      let detectionRangeSelect: HTMLSelectElement | null = null
      if (options.showDetectionRange) {
        const detectionRangeRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_detection_range')
        )
        const levels: NpcDetectionRangeLevel[] = ['near', 'medium', 'far']
        detectionRangeSelect = EditorUIHelper.createSelect({
          options: levels.map((lvl) => ({
            value: lvl,
            label: localizer.t(`editor_enemy_detection_${lvl}`),
          })),
          selected: options.data.detectionRangeLevel ?? 'near',
        })
        detectionRangeRow.row.appendChild(detectionRangeSelect)
        basicPanel.appendChild(detectionRangeRow.row)
      }

      // Faction
      const allFactions = this.context.getFactions()

      const factionRow = EditorUIHelper.createFormRow(
        localizer.t('editor_faction_prop_faction')
      )
      const factionSelectEl = EditorUIHelper.createSelect({
        options: allFactions.map((f) => ({ value: f, label: f })),
        selected: options.data.factionId,
        width: '140px',
      })
      factionRow.row.appendChild(factionSelectEl)

      const newFactionBtn = EditorUIHelper.createButton(
        localizer.t('editor_faction_new'),
        { primary: false }
      )
      newFactionBtn.style.padding = '4px 8px'
      newFactionBtn.style.fontSize = '11px'
      factionRow.row.appendChild(newFactionBtn)
      basicPanel.appendChild(factionRow.row)

      newFactionBtn.addEventListener('click', () => {
        void this.handleCreateFaction(
          factionSelectEl,
          rebuildFactionCheckboxes,
          localizer.t('editor_faction_new_prompt')
        )
      })

      const createFactionSection = (labelKey: string): HTMLDivElement => {
        const label = document.createElement('div')
        label.textContent = localizer.t(labelKey)
        label.style.cssText =
          'font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px;margin-top:8px;'
        basicPanel.appendChild(label)
        const container = document.createElement('div')
        container.style.cssText =
          'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;'
        basicPanel.appendChild(container)
        return container
      }
      const npcFactionContainer = createFactionSection(
        'editor_faction_prop_npc_factions'
      )
      const allyFactionContainer = createFactionSection(
        'editor_faction_prop_ally_factions'
      )

      const getNpcFactionSelected = (): string[] => {
        const result: string[] = []
        npcFactionContainer
          .querySelectorAll<HTMLInputElement>('input[type=checkbox]')
          .forEach((cb) => {
            if (cb.checked) result.push(cb.value)
          })
        return result
      }
      const getAllyFactionSelected = (): string[] => {
        const result: string[] = []
        allyFactionContainer
          .querySelectorAll<HTMLInputElement>('input[type=checkbox]')
          .forEach((cb) => {
            if (cb.checked) result.push(cb.value)
          })
        return result
      }

      const createFactionCheckbox = (
        container: HTMLDivElement,
        factionId: string,
        checked: boolean,
        onCheck: (fid: string, val: boolean) => void
      ) => {
        const wrapper = document.createElement('label')
        wrapper.style.cssText =
          'display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;padding:3px 6px;border:1px solid rgba(255,255,255,0.2);'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.value = factionId
        cb.checked = checked
        cb.addEventListener('change', () => onCheck(factionId, cb.checked))
        wrapper.appendChild(cb)
        wrapper.appendChild(document.createTextNode(factionId))
        container.appendChild(wrapper)
      }

      const rebuildFactionCheckboxes = (
        overrideNpc?: string[],
        overrideAlly?: string[]
      ) => {
        const currentFaction = factionSelectEl.value
        const npcSel = overrideNpc ?? getNpcFactionSelected()
        const allySel = overrideAlly ?? getAllyFactionSelected()
        const factions = this.context.getFactions()

        npcFactionContainer.innerHTML = ''
        allyFactionContainer.innerHTML = ''

        for (const fid of factions) {
          if (fid === currentFaction) continue
          const isNpc = npcSel.includes(fid)
          const isAlly = allySel.includes(fid)
          createFactionCheckbox(npcFactionContainer, fid, isNpc, (f, v) => {
            if (v) {
              const allyCb =
                allyFactionContainer.querySelector<HTMLInputElement>(
                  `input[value="${f}"]`
                )
              if (allyCb) allyCb.checked = false
            }
          })
          createFactionCheckbox(allyFactionContainer, fid, isAlly, (f, v) => {
            if (v) {
              const npcCb = npcFactionContainer.querySelector<HTMLInputElement>(
                `input[value="${f}"]`
              )
              if (npcCb) npcCb.checked = false
            }
          })
        }
      }

      rebuildFactionCheckboxes(
        options.data.npcFactions,
        options.data.allyFactions
      )
      factionSelectEl.addEventListener('change', () =>
        rebuildFactionCheckboxes()
      )

      // Facing
      const facingRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_facing')
      )
      const facingSelect = EditorUIHelper.createSelect({
        options: [
          { value: '1', label: localizer.t('editor_enemy_facing_right') },
          { value: '-1', label: localizer.t('editor_enemy_facing_left') },
        ],
        selected: String(options.data.facing ?? 1),
      })
      facingRow.row.appendChild(facingSelect)
      basicPanel.appendChild(facingRow.row)

      const initialAttackModuleRow = EditorUIHelper.createFormRow(
        localizer.t('editor_character_prop_attack_module')
      )
      const initialAttackModuleSelect = EditorUIHelper.createSelect({
        options: NORMAL_ATTACK_MOVESET_OPTIONS.map((option) => ({
          value: option.value,
          label: localizer.t(option.labelKey),
        })),
        selected:
          options.data.initialNormalMovesetId ??
          getDefaultNormalAttackMovesetId(options.attackMovesetOwner),
      })
      initialAttackModuleRow.row.appendChild(initialAttackModuleSelect)
      basicPanel.appendChild(initialAttackModuleRow.row)

      // Attack Moves List
      let buildAttackMoveValues: (() => NpcAttackMove[]) | null = null
      let updateAttackMovesForWeapon:
        | ((wt: WeaponType | 'none') => void)
        | null = null

      if (options.showAttackMoves) {
        let attackMoveEntries: NpcAttackMove[] = normalizeNpcAttackMoves(
          options.data.attackMoves,
          options.data.mainWeaponConfig?.weaponType
        ).map((m) => ({ movesetId: m.movesetId, probability: m.probability }))

        const allMovesetOptions = NPC_ATTACK_MOVE_OPTIONS.map((opt) => ({
          value: opt.value as NpcAttackMoveId,
          label: localizer.t(opt.labelKey),
        }))

        const attackMovesHeaderRow = EditorUIHelper.createFormRow(
          localizer.t('editor_attack_moves_label')
        )
        const addMoveBtn = EditorUIHelper.createButton(
          localizer.t('editor_attack_moves_add')
        )
        addMoveBtn.style.padding = '4px 8px'
        addMoveBtn.style.fontSize = '11px'
        attackMovesHeaderRow.row.appendChild(addMoveBtn)
        basicPanel.appendChild(attackMovesHeaderRow.row)

        const moveList = document.createElement('div')
        moveList.style.cssText =
          'display:flex;flex-direction:column;gap:8px;margin:-4px 0 4px 110px;'
        basicPanel.appendChild(moveList)

        // 总计显示行
        const totalRow = document.createElement('div')
        totalRow.style.cssText =
          'font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 10px 110px;'
        basicPanel.appendChild(totalRow)

        // 新增时均分所有条目概率
        const redistributeEqually = () => {
          const n = attackMoveEntries.length
          if (n === 0) return
          const base = Math.floor(100 / n)
          const extra = 100 - base * n
          for (let j = 0; j < n; j++) {
            attackMoveEntries[j].probability = base + (j === 0 ? extra : 0)
          }
        }

        const getTotalProbability = () =>
          attackMoveEntries.reduce((s, m) => s + m.probability, 0)

        const updateTotalDisplay = () => {
          const total = getTotalProbability()
          totalRow.textContent = `${localizer.t('editor_attack_moves_total')} ${total}%`
          totalRow.style.color =
            total > 100
              ? '#e05555'
              : total === 100
                ? 'rgba(255,255,255,0.4)'
                : 'rgba(255,255,255,0.5)'
        }

        // 浮动选择菜单（挂在 modal 上，随弹窗一起销毁）
        const pickerMenu = document.createElement('div')
        pickerMenu.style.cssText = [
          'position:fixed;z-index:20000;',
          'background:rgba(20,20,20,0.97);',
          'border:1px solid rgba(255,255,255,0.2);',
          'display:none;flex-direction:column;',
          'min-width:140px;',
        ].join('')
        modal.appendChild(pickerMenu)

        const hidePicker = () => {
          pickerMenu.style.display = 'none'
        }
        modal.addEventListener('click', hidePicker)

        const showPicker = () => {
          const added = new Set(attackMoveEntries.map((e) => e.movesetId))
          const available = allMovesetOptions.filter(
            (opt) => !added.has(opt.value)
          )
          if (available.length === 0) return
          pickerMenu.innerHTML = ''
          for (const opt of available) {
            const item = document.createElement('div')
            item.textContent = opt.label
            item.style.cssText = [
              'padding:6px 12px;cursor:pointer;font-size:12px;',
              'color:#fff;font-family:monospace;',
            ].join('')
            item.addEventListener('mouseenter', () => {
              item.style.background = 'rgba(255,255,255,0.12)'
            })
            item.addEventListener('mouseleave', () => {
              item.style.background = ''
            })
            item.addEventListener('click', (e) => {
              e.stopPropagation()
              attackMoveEntries.push({ movesetId: opt.value, probability: 0 })
              redistributeEqually()
              hidePicker()
              renderMoveRows()
            })
            pickerMenu.appendChild(item)
          }
          const rect = addMoveBtn.getBoundingClientRect()
          pickerMenu.style.left = `${rect.left}px`
          pickerMenu.style.top = `${rect.bottom + 2}px`
          pickerMenu.style.display = 'flex'
        }

        addMoveBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (pickerMenu.style.display === 'flex') {
            hidePicker()
          } else {
            showPicker()
          }
        })

        const renderMoveRows = () => {
          moveList.innerHTML = ''
          updateTotalDisplay()
          if (attackMoveEntries.length === 0) {
            const emptyText = document.createElement('div')
            emptyText.textContent = localizer.t('editor_attack_moves_empty')
            emptyText.style.cssText =
              'font-size:11px;color:rgba(255,255,255,0.45);padding:2px 0;'
            moveList.appendChild(emptyText)
            return
          }

          for (let i = 0; i < attackMoveEntries.length; i++) {
            const entry = attackMoveEntries[i]
            const row = document.createElement('div')
            row.style.cssText = 'display:flex;align-items:center;gap:6px;'

            // 招式名称（静态文字）
            const nameLabel = document.createElement('span')
            const opt = allMovesetOptions.find(
              (o) => o.value === entry.movesetId
            )
            nameLabel.textContent = opt?.label ?? entry.movesetId
            nameLabel.style.cssText =
              'font-size:12px;color:#fff;font-family:monospace;width:100px;flex-shrink:0;'
            row.appendChild(nameLabel)

            // 概率
            const probInput = EditorUIHelper.createNumberInput({
              value: entry.probability,
              min: '1',
              max: '100',
              step: '1',
              width: '52px',
            })
            row.appendChild(probInput)

            const pctLabel = document.createElement('span')
            pctLabel.textContent = '%'
            pctLabel.style.cssText =
              'font-size:12px;color:rgba(255,255,255,0.6);flex-shrink:0;'
            row.appendChild(pctLabel)

            const removeBtn = EditorUIHelper.createButton(
              localizer.t('editor_attack_moves_remove')
            )
            removeBtn.style.padding = '3px 7px'
            removeBtn.style.fontSize = '11px'
            row.appendChild(removeBtn)

            const syncProb = () => {
              const v = Number.parseInt(probInput.value, 10)
              if (!Number.isFinite(v)) {
                probInput.value = String(entry.probability)
                return
              }
              // 其余条目之和
              const othersSum = attackMoveEntries.reduce(
                (s, m, idx) => s + (idx !== i ? m.probability : 0),
                0
              )
              const maxAllowed = Math.max(1, 100 - othersSum)
              entry.probability = Math.max(1, Math.min(maxAllowed, v))
              probInput.value = String(entry.probability)
              updateTotalDisplay()
            }
            probInput.addEventListener('change', syncProb)
            probInput.addEventListener('blur', syncProb)
            removeBtn.addEventListener('click', () => {
              attackMoveEntries.splice(i, 1)
              if (attackMoveEntries.length > 0) redistributeEqually()
              renderMoveRows()
            })

            moveList.appendChild(row)
          }
        }

        renderMoveRows()
        buildAttackMoveValues = () =>
          attackMoveEntries.map((m) => ({
            movesetId: m.movesetId,
            probability: m.probability,
          }))

        updateAttackMovesForWeapon = (wt: WeaponType | 'none') => {
          const weaponType = wt === 'none' ? undefined : wt
          const defaults = buildDefaultNpcAttackMoves(weaponType)
          attackMoveEntries = defaults.map((m) => ({ ...m }))
          renderMoveRows()
        }
      }

      // Health
      const healthRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_max_health')
      )
      const healthInput = EditorUIHelper.createNumberInput({
        value: options.data.maxHealth,
        min: '1',
        step: '1',
      })
      healthRow.row.appendChild(healthInput)
      basicPanel.appendChild(healthRow.row)

      // Posture
      const postureRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_max_posture')
      )
      const postureInput = EditorUIHelper.createNumberInput({
        value: options.data.maxPosture,
        min: '0',
        step: '1',
      })
      postureRow.row.appendChild(postureInput)
      basicPanel.appendChild(postureRow.row)

      // Toughness
      const toughnessRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_max_toughness')
      )
      const toughnessInput = EditorUIHelper.createNumberInput({
        value: options.data.maxToughness,
        min: '0',
        step: '1',
      })
      toughnessRow.row.appendChild(toughnessInput)
      basicPanel.appendChild(toughnessRow.row)

      const debugNoDamageRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_debug_no_damage')
      )
      const debugNoDamageSelect = EditorUIHelper.createSelect({
        options: [
          { value: '0', label: localizer.t('editor_debug_switch_off') },
          { value: '1', label: localizer.t('editor_debug_switch_on') },
        ],
        selected: options.data.debugNoDamage ? '1' : '0',
      })
      debugNoDamageRow.row.appendChild(debugNoDamageSelect)
      basicPanel.appendChild(debugNoDamageRow.row)

      const debugNoDeathRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_debug_no_death')
      )
      const debugNoDeathSelect = EditorUIHelper.createSelect({
        options: [
          { value: '0', label: localizer.t('editor_debug_switch_off') },
          { value: '1', label: localizer.t('editor_debug_switch_on') },
        ],
        selected: options.data.debugNoDeath ? '1' : '0',
      })
      debugNoDeathRow.row.appendChild(debugNoDeathSelect)
      basicPanel.appendChild(debugNoDeathRow.row)

      let redTapeCheckbox: HTMLInputElement | null = null
      if (options.showRedTape) {
        const redTapeRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_red_tape')
        )
        redTapeCheckbox = document.createElement('input')
        redTapeCheckbox.type = 'checkbox'
        redTapeCheckbox.checked = options.data.redTapeEnabled === true
        redTapeCheckbox.style.cssText = 'cursor:pointer;width:14px;height:14px;'
        redTapeRow.row.appendChild(redTapeCheckbox)
        basicPanel.appendChild(redTapeRow.row)
      }

      let retreatEnabledCheckbox: HTMLInputElement | null = null
      let retreatDelayInput: HTMLInputElement | null = null
      if (options.showRetreat) {
        const retreatEnabledRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_retreat_enabled')
        )
        retreatEnabledCheckbox = document.createElement('input')
        retreatEnabledCheckbox.type = 'checkbox'
        retreatEnabledCheckbox.checked = options.data.retreatEnabled === true
        retreatEnabledCheckbox.style.cssText =
          'cursor:pointer;width:14px;height:14px;'
        retreatEnabledRow.row.appendChild(retreatEnabledCheckbox)
        basicPanel.appendChild(retreatEnabledRow.row)

        const retreatDelayRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_retreat_delay')
        )
        retreatDelayInput = EditorUIHelper.createNumberInput({
          value: options.data.retreatDelaySec ?? 0,
          min: '0',
          step: '1',
        })
        retreatDelayInput.disabled = !retreatEnabledCheckbox.checked
        retreatDelayRow.row.appendChild(retreatDelayInput)
        basicPanel.appendChild(retreatDelayRow.row)

        retreatEnabledCheckbox.addEventListener('change', () => {
          if (retreatDelayInput) {
            retreatDelayInput.disabled = !retreatEnabledCheckbox!.checked
          }
        })
      }

      let canBeFollowerCheckbox: HTMLInputElement | null = null
      if (options.showCanBeFollower) {
        const canBeFollowerRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_can_be_follower')
        )
        canBeFollowerCheckbox = document.createElement('input')
        canBeFollowerCheckbox.type = 'checkbox'
        canBeFollowerCheckbox.checked = options.data.canBeFollower === true
        canBeFollowerCheckbox.style.cssText =
          'cursor:pointer;width:14px;height:14px;'
        canBeFollowerRow.row.appendChild(canBeFollowerCheckbox)
        basicPanel.appendChild(canBeFollowerRow.row)
      }

      // === 外观 Tab ===
      const defaultDiameter = options.data.radius * 2
      let bodyProfile = options.data.bodyProfile
      const bodyWidthDefault =
        getCharacterBodyProfileWidth(bodyProfile) > 0
          ? getCharacterBodyProfileWidth(bodyProfile)
          : defaultDiameter
      const bodyHeightDefault =
        getCharacterBodyProfileHeight(bodyProfile) > 0
          ? getCharacterBodyProfileHeight(bodyProfile)
          : options.data.bodyHeight > 0
            ? options.data.bodyHeight
            : bodyWidthDefault

      const bodyWidthRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_body_width')
      )
      const bodyWidthInput = EditorUIHelper.createNumberInput({
        value: bodyWidthDefault,
        min: '0.5',
        step: '0.1',
      })
      bodyWidthRow.row.appendChild(bodyWidthInput)
      appearancePanel.appendChild(bodyWidthRow.row)

      const bodyHeightRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_body_height')
      )
      const bodyHeightInput = EditorUIHelper.createNumberInput({
        value: bodyHeightDefault,
        min: '0.5',
        step: '0.1',
      })
      bodyHeightRow.row.appendChild(bodyHeightInput)
      appearancePanel.appendChild(bodyHeightRow.row)

      const bodyDrawRow = EditorUIHelper.createFormRow(
        localizer.t('editor_body_drawer_label')
      )
      const bodyDrawBtn = EditorUIHelper.createButton(
        localizer.t('editor_body_drawer_open'),
        { primary: true }
      )
      bodyDrawBtn.addEventListener('click', async () => {
        const bodyWidthVal = Number.parseFloat(bodyWidthInput.value)
        const bodyHeightVal = Number.parseFloat(bodyHeightInput.value)
        const currentWidth =
          Number.isFinite(bodyWidthVal) && bodyWidthVal > 0
            ? bodyWidthVal
            : defaultDiameter
        const currentHeight =
          Number.isFinite(bodyHeightVal) && bodyHeightVal > 0
            ? bodyHeightVal
            : currentWidth
        const currentFacingValue = Number.parseInt(facingSelect.value, 10)
        const nextBodyProfile = await this.bodyDrawer.show({
          title: localizer.t('editor_body_drawer_title'),
          initialProfile: bodyProfile,
          initialColor: getCharacterBodyColor(bodyProfile, options.data.color),
          defaultBodyWidth: currentWidth,
          defaultBodyHeight: currentHeight,
          initialFacing:
            Number.isFinite(currentFacingValue) && currentFacingValue < 0
              ? -1
              : 1,
        })
        if (nextBodyProfile === undefined) {
          return
        }
        bodyProfile = nextBodyProfile ?? undefined
        if (bodyProfile) {
          const nextProfileWidth = getCharacterBodyProfileWidth(bodyProfile)
          const nextProfileHeight = getCharacterBodyProfileHeight(bodyProfile)
          if (nextProfileWidth > 0) {
            bodyWidthInput.value = String(nextProfileWidth)
          }
          if (nextProfileHeight > 0) {
            bodyHeightInput.value = String(nextProfileHeight)
          }
        }
        if (bodyProfile) {
          options.data.color = getCharacterBodyColor(
            bodyProfile,
            options.data.color
          )
        }
        if (options.marker) {
          options.marker.bodyProfile = bodyProfile
        }
        options.data.bodyProfile = bodyProfile
        updateCharacterVisualFromInputs()
        renderCharacterPreview()
      })
      bodyDrawRow.row.appendChild(bodyDrawBtn)
      appearancePanel.appendChild(bodyDrawRow.row)

      const mainBinding =
        options.weaponBindings.find((binding) => binding.slot === 'main') ??
        null
      const secondaryBinding =
        options.weaponBindings.find(
          (binding) => binding.slot === 'secondary'
        ) ?? null

      if (hasWeaponBindings) {
        equipmentPanel.appendChild(weaponSlotsCanvas)
      }

      const createWeaponRow = (binding: CharacterWeaponBinding) => {
        const row = EditorUIHelper.createFormRow(binding.label)
        const select = EditorUIHelper.createSelect({
          options: binding.options,
          selected: binding.getWeaponType() ?? 'none',
        })
        row.row.appendChild(select)

        const configBtn = EditorUIHelper.createButton(
          localizer.t('editor_weapon_menu_properties')
        )
        configBtn.style.fontSize = '11px'
        configBtn.style.marginLeft = '8px'
        configBtn.addEventListener('click', async () => {
          const weaponValue = select.value
          if (weaponValue && weaponValue !== 'none') {
            const weaponMarker = binding.ensureWeaponMarker(
              weaponValue as WeaponType
            )
            if (weaponMarker) {
              await this.showWeaponPropertiesDialog(weaponMarker, {
                useMapSnapshot: options.useMapSnapshot,
                captureHistoryOnCommit: options.captureHistoryOnCommit,
              })
              renderCharacterPreview()
            }
          }
        })
        row.row.appendChild(configBtn)
        equipmentPanel.appendChild(row.row)

        const updateConfigBtnVisibility = () => {
          const weaponType = select.value
          configBtn.style.display =
            weaponType && weaponType !== 'none' ? 'inline-block' : 'none'
        }

        select.addEventListener('change', () => {
          const weaponType = select.value
          if (weaponType && weaponType !== 'none') {
            const weaponMarker = binding.ensureWeaponMarker(
              weaponType as WeaponType
            )
            binding.setWeaponType(weaponType as WeaponType)
            if (weaponMarker) {
              binding.setWeaponMarker(weaponMarker)
            }
            if (binding.slot === 'main') {
              const currentMovesetId = initialAttackModuleSelect.value
              if (
                !isMovesetCompatibleWithWeaponType(
                  currentMovesetId,
                  weaponType as WeaponType
                )
              ) {
                const defaultId = getDefaultAttackMovesetIdForWeaponType(
                  weaponType as WeaponType
                )
                if (defaultId) {
                  initialAttackModuleSelect.value = defaultId
                }
              }

              if (updateAttackMovesForWeapon) {
                updateAttackMovesForWeapon(weaponType as WeaponType)
              }
            }
          } else {
            const marker = binding.getWeaponMarker()
            if (marker) {
              this.context.weaponMarkerMap.delete(marker)
            }
            binding.setWeaponMarker(undefined)
            binding.setWeaponType(undefined)

            if (binding.slot === 'main' && updateAttackMovesForWeapon) {
              updateAttackMovesForWeapon('none')
            }
          }
          updateConfigBtnVisibility()
          updateCharacterVisualFromInputs()
          renderCharacterPreview()
        })
        updateConfigBtnVisibility()
        return select
      }

      let mainWeaponSelect: HTMLSelectElement | null = null
      let secondaryWeaponSelect: HTMLSelectElement | null = null

      if (mainBinding) {
        mainWeaponSelect = createWeaponRow(mainBinding)
      }
      if (secondaryBinding) {
        secondaryWeaponSelect = createWeaponRow(secondaryBinding)
      }

      let buildNpcDropValues: (() => MapNpcDropItem[]) | null = null
      if (options.showDrops) {
        const dropItemOptions = this.getNpcDropItemOptions()
        let dropEntries =
          options.data.drops === undefined
            ? buildDefaultNpcDropList(
                (mainBinding?.getWeaponType() ?? undefined) as
                  | WeaponType
                  | undefined,
                (secondaryBinding?.getWeaponType() ?? undefined) as
                  | WeaponType
                  | undefined
              )
            : normalizeNpcDropList(options.data.drops)

        const dropsRow = EditorUIHelper.createFormRow(
          localizer.t('editor_enemy_prop_drops')
        )
        const addDropBtn = EditorUIHelper.createButton(
          localizer.t('editor_enemy_prop_drops_add')
        )
        addDropBtn.style.padding = '4px 8px'
        addDropBtn.style.fontSize = '11px'
        dropsRow.row.appendChild(addDropBtn)
        basicPanel.appendChild(dropsRow.row)

        const dropList = document.createElement('div')
        dropList.style.cssText =
          'display:flex;flex-direction:column;gap:8px;margin:-4px 0 12px 122px;'
        basicPanel.appendChild(dropList)

        const renderDropRows = () => {
          dropList.innerHTML = ''
          if (dropEntries.length === 0) {
            const emptyText = document.createElement('div')
            emptyText.textContent = localizer.t('editor_enemy_prop_drops_empty')
            emptyText.style.cssText =
              'font-size:11px;color:rgba(255,255,255,0.45);padding:2px 0;'
            dropList.appendChild(emptyText)
            return
          }

          for (let i = 0; i < dropEntries.length; i++) {
            const rowData = dropEntries[i]
            const row = document.createElement('div')
            row.style.cssText =
              'display:flex;align-items:center;gap:8px;flex-wrap:wrap;'

            const itemSelect = EditorUIHelper.createSelect({
              options: dropItemOptions,
              selected: rowData.itemType,
              width: '160px',
            })
            row.appendChild(itemSelect)

            const chanceInput = EditorUIHelper.createNumberInput({
              value: rowData.chance,
              min: '1',
              max: '100',
              step: '1',
              width: '72px',
            })
            row.appendChild(chanceInput)

            const percentText = document.createElement('span')
            percentText.textContent = '%'
            percentText.style.cssText = 'font-size:12px;color:#ffffff;'
            row.appendChild(percentText)

            const countLabel = document.createElement('span')
            countLabel.textContent = 'x'
            countLabel.style.cssText = 'font-size:12px;color:#ffffff;'
            row.appendChild(countLabel)

            const countInput = EditorUIHelper.createNumberInput({
              value: rowData.count,
              min: '1',
              max: String(MAX_NPC_DROP_COUNT),
              step: '1',
              width: '56px',
            })
            row.appendChild(countInput)

            const removeBtn = EditorUIHelper.createButton(
              localizer.t('editor_enemy_prop_drops_remove')
            )
            removeBtn.style.padding = '4px 8px'
            removeBtn.style.fontSize = '11px'
            row.appendChild(removeBtn)

            itemSelect.addEventListener('change', () => {
              const itemType = normalizeNpcDropItemType(itemSelect.value)
              if (!itemType) {
                itemSelect.value = rowData.itemType
                return
              }
              rowData.itemType = itemType
            })

            const syncChanceValue = () => {
              const chance = Number.parseInt(chanceInput.value, 10)
              if (!Number.isFinite(chance)) {
                chanceInput.value = String(rowData.chance)
                return
              }
              rowData.chance = normalizeNpcDropChance(chance)
              chanceInput.value = String(rowData.chance)
            }

            chanceInput.addEventListener('change', syncChanceValue)
            chanceInput.addEventListener('blur', syncChanceValue)

            const syncCountValue = () => {
              const count = Number.parseInt(countInput.value, 10)
              if (!Number.isFinite(count)) {
                countInput.value = String(rowData.count)
                return
              }
              rowData.count = normalizeNpcDropCount(count)
              countInput.value = String(rowData.count)
            }

            countInput.addEventListener('change', syncCountValue)
            countInput.addEventListener('blur', syncCountValue)

            removeBtn.addEventListener('click', () => {
              dropEntries.splice(i, 1)
              renderDropRows()
            })

            dropList.appendChild(row)
          }
        }

        addDropBtn.addEventListener('click', () => {
          const defaultItemType =
            normalizeNpcDropItemType(dropItemOptions[0]?.value) ?? 'sword'
          dropEntries.push({
            itemType: defaultItemType,
            chance: 100,
            count: 1,
          })
          renderDropRows()
        })

        renderDropRows()
        buildNpcDropValues = () => normalizeNpcDropList(dropEntries)
      }

      // Buttons
      const buttonRow = EditorUIHelper.createButtonRow()
      const confirmBtn = EditorUIHelper.createButton(
        options.confirmLabel ?? localizer.t('editor_btn_confirm'),
        { primary: true }
      )
      const cancelBtn = EditorUIHelper.createButton(
        localizer.t('editor_btn_cancel')
      )
      buttonRow.appendChild(confirmBtn)
      buttonRow.appendChild(cancelBtn)
      footerPanel.appendChild(buttonRow)

      // Preview rendering
      const getBodyColor = () =>
        getCharacterBodyColor(bodyProfile, options.data.color)

      type WeaponSlotPreview = {
        hasWeapon: boolean
        weaponType: WeaponType
        weaponWidth: number
        weaponHeight: number
        sizeLevel: number
        sizeMaxLevel: number
        ammo: number
      }

      const mainSlotPreview: WeaponSlotPreview = {
        hasWeapon: false,
        weaponType: 'sword',
        weaponWidth: 0,
        weaponHeight: 0,
        sizeLevel: 0,
        sizeMaxLevel: 0,
        ammo: 0,
      }

      const secondarySlotPreview: WeaponSlotPreview = {
        hasWeapon: false,
        weaponType: 'sword',
        weaponWidth: 0,
        weaponHeight: 0,
        sizeLevel: 0,
        sizeMaxLevel: 0,
        ammo: 0,
      }

      const previewPlayerPos = { x: 0, y: 0 }
      const previewWeaponTransform = { x: 0, y: 0, rotation: 0 }
      const weaponAmmoTextCache: string[] = []
      const previewBasePixelsPerMeter = 60
      const previewWeaponColor = '#b4bdc7'

      const getAmmoText = (ammo: number): string => {
        const cached = weaponAmmoTextCache[ammo]
        if (cached) return cached
        const text = String(ammo)
        weaponAmmoTextCache[ammo] = text
        return text
      }

      const resetWeaponSlotPreview = (slot: WeaponSlotPreview) => {
        slot.hasWeapon = false
        slot.weaponType = 'sword'
        slot.weaponWidth = 0
        slot.weaponHeight = 0
        slot.sizeLevel = 0
        slot.sizeMaxLevel = 0
        slot.ammo = 0
      }

      const fillWeaponSlotPreview = (
        slot: WeaponSlotPreview,
        weaponValue: string,
        marker: WeaponMarker | undefined,
        defaultBowAmmo: number
      ) => {
        if (!weaponValue || weaponValue === 'none') {
          resetWeaponSlotPreview(slot)
          return
        }

        const weaponType = weaponValue as WeaponType
        const template = WEAPON_DEFAULT_DATA[weaponType]
        const markerData = marker
          ? this.context.weaponMarkerMap.get(marker)
          : null
        const markerMatches =
          markerData && markerData.weaponType === weaponType ? markerData : null
        const sizeLevel = markerMatches
          ? markerMatches.sizeLevel
          : template.sizeLevel
        const scaleFactor = computeWeaponScaleFactor(template, sizeLevel)

        slot.hasWeapon = true
        slot.weaponType = weaponType
        slot.weaponWidth = template.width * scaleFactor
        slot.weaponHeight = template.height * scaleFactor
        slot.sizeLevel = sizeLevel
        slot.sizeMaxLevel = template.sizeMaxLevel
        slot.ammo = isAmmoLimitedWeaponType(weaponType)
          ? (markerMatches?.bowAmmo ?? defaultBowAmmo)
          : 0
      }

      const renderWeaponSlotsPreview = () => {
        if (!weaponSlotsCtx || options.weaponBindings.length === 0) {
          return
        }

        const canvasWidth = weaponSlotsCanvas.width
        const canvasHeight = weaponSlotsCanvas.height
        weaponSlotsCtx.clearRect(0, 0, canvasWidth, canvasHeight)

        const totalWidth = HUD_SLOT_SIZE * 2 + HUD_SLOT_SPACING
        const startX = Math.round((canvasWidth - totalWidth) / 2)
        const slotY = Math.round((canvasHeight - HUD_SLOT_SIZE) / 2)
        const secondaryX = startX + HUD_SLOT_SIZE + HUD_SLOT_SPACING

        const mainAmmoValue =
          mainSlotPreview.ammo < 0 ? 0 : mainSlotPreview.ammo
        const secondaryAmmoValue =
          secondarySlotPreview.ammo < 0 ? 0 : secondarySlotPreview.ammo

        drawHudWeaponSlot(
          weaponSlotsCtx,
          startX,
          slotY,
          HUD_SLOT_SIZE,
          true,
          mainSlotPreview.hasWeapon,
          mainSlotPreview.weaponType,
          mainSlotPreview.weaponWidth,
          mainSlotPreview.weaponHeight,
          mainSlotPreview.sizeLevel,
          mainSlotPreview.sizeMaxLevel,
          mainAmmoValue,
          isAmmoLimitedWeaponType(mainSlotPreview.weaponType)
            ? getAmmoText(mainAmmoValue)
            : ''
        )
        drawHudWeaponSlot(
          weaponSlotsCtx,
          secondaryX,
          slotY,
          HUD_SLOT_SIZE,
          false,
          secondarySlotPreview.hasWeapon,
          secondarySlotPreview.weaponType,
          secondarySlotPreview.weaponWidth,
          secondarySlotPreview.weaponHeight,
          secondarySlotPreview.sizeLevel,
          secondarySlotPreview.sizeMaxLevel,
          secondaryAmmoValue,
          isAmmoLimitedWeaponType(secondarySlotPreview.weaponType)
            ? getAmmoText(secondaryAmmoValue)
            : ''
        )
      }

      const renderCharacterPreview = () => {
        if (!previewCtx) {
          return
        }
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
        const bodyWidthVal = Number.parseFloat(bodyWidthInput.value)
        const radius =
          Number.isFinite(bodyWidthVal) && bodyWidthVal > 0
            ? bodyWidthVal / 2
            : options.data.radius
        const bodyHeightVal = Number.parseFloat(bodyHeightInput.value)
        const bodyHeight =
          Number.isFinite(bodyHeightVal) && bodyHeightVal > 0
            ? bodyHeightVal
            : 0
        const previewBodyWidth = Math.max(0.5, radius * 2)
        const previewBodyHeight = Math.max(
          0.5,
          bodyHeight > 0 ? bodyHeight : radius * 2
        )
        const fitScaleX = (previewCanvas.width * 0.52) / previewBodyWidth
        const fitScaleY = (previewCanvas.height * 0.42) / previewBodyHeight
        const previewPixelsPerMeter = Math.max(
          16,
          Math.floor(Math.min(previewBasePixelsPerMeter, fitScaleX, fitScaleY))
        )
        const color = getBodyColor()
        const facing = Number.parseInt(facingSelect.value, 10)
        const bodyTextureImage = this.getBodyTextureImage(
          bodyProfile,
          renderCharacterPreview
        )

        if (options.weaponBindings.length > 0) {
          if (mainBinding && mainWeaponSelect) {
            fillWeaponSlotPreview(
              mainSlotPreview,
              mainWeaponSelect.value,
              mainBinding.getWeaponMarker(),
              mainBinding.defaultBowAmmo
            )
          } else {
            resetWeaponSlotPreview(mainSlotPreview)
          }
          if (secondaryBinding && secondaryWeaponSelect) {
            fillWeaponSlotPreview(
              secondarySlotPreview,
              secondaryWeaponSelect.value,
              secondaryBinding.getWeaponMarker(),
              secondaryBinding.defaultBowAmmo
            )
          } else {
            resetWeaponSlotPreview(secondarySlotPreview)
          }
        }

        const centerX = Math.round(previewCanvas.width / 2)
        const centerY = Math.round((previewCanvas.height * 58) / 100)
        previewPlayerPos.x = centerX / previewPixelsPerMeter
        previewPlayerPos.y = centerY / previewPixelsPerMeter

        const renderMainWeapon = () => {
          if (!mainSlotPreview.hasWeapon) {
            return
          }
          setWeaponBackTransform(
            previewPlayerPos,
            facing,
            previewWeaponTransform,
            radius,
            mainSlotPreview.weaponType,
            mainSlotPreview.weaponWidth
          )
          const weaponX = Math.round(
            previewWeaponTransform.x * previewPixelsPerMeter
          )
          const weaponY = Math.round(
            previewWeaponTransform.y * previewPixelsPerMeter
          )
          const weaponWidth = Math.round(
            mainSlotPreview.weaponWidth * previewPixelsPerMeter
          )
          const weaponHeight = Math.round(
            mainSlotPreview.weaponHeight * previewPixelsPerMeter
          )
          if (weaponWidth <= 0 || weaponHeight <= 0) {
            return
          }

          previewCtx.save()
          previewCtx.translate(weaponX, weaponY)
          previewCtx.rotate(previewWeaponTransform.rotation)
          renderWeapon(
            previewCtx,
            this.getWeaponRenderType(mainSlotPreview.weaponType),
            weaponWidth,
            weaponHeight,
            previewWeaponColor,
            false,
            0
          )
          previewCtx.restore()
        }

        if (facing < 0) {
          renderMainWeapon()
        }
        renderNpcPreviewToContext(
          previewCtx,
          centerX,
          centerY,
          radius,
          bodyHeight,
          color,
          previewPixelsPerMeter,
          facing,
          bodyProfile ?? null,
          bodyTextureImage
        )
        if (facing >= 0) {
          renderMainWeapon()
        }
        renderWeaponSlotsPreview()
      }

      const updateCharacterVisualFromInputs = () => {
        const bodyWidthVal = Number.parseFloat(bodyWidthInput.value)
        const bodyHeightVal = Number.parseFloat(bodyHeightInput.value)
        const facing = Number.parseInt(facingSelect.value, 10)
        if (bodyProfile) {
          if (Number.isFinite(bodyWidthVal) && bodyWidthVal > 0) {
            bodyProfile.width = bodyWidthVal
          }
          if (Number.isFinite(bodyHeightVal) && bodyHeightVal > 0) {
            bodyProfile.height = bodyHeightVal
          }
          const resolvedProfileWidth = getCharacterBodyProfileWidth(bodyProfile)
          const resolvedProfileHeight =
            getCharacterBodyProfileHeight(bodyProfile)
          if (resolvedProfileWidth > 0) {
            bodyProfile.width = resolvedProfileWidth
            bodyWidthInput.value = String(resolvedProfileWidth)
          }
          if (resolvedProfileHeight > 0) {
            bodyProfile.height = resolvedProfileHeight
            bodyHeightInput.value = String(resolvedProfileHeight)
          }
        }
        const resolvedBodyWidth = bodyProfile
          ? getCharacterBodyProfileWidth(bodyProfile)
          : bodyWidthVal
        const resolvedBodyHeight = bodyProfile
          ? getCharacterBodyProfileHeight(bodyProfile)
          : bodyHeightVal
        if (Number.isFinite(resolvedBodyWidth) && resolvedBodyWidth > 0) {
          const radiusMeters = resolvedBodyWidth / 2
          const bodyHeight =
            Number.isFinite(resolvedBodyHeight) && resolvedBodyHeight > 0
              ? resolvedBodyHeight
              : 0
          if (options.marker) {
            options.updateMarkerVisual(
              options.marker,
              radiusMeters,
              bodyHeight,
              getBodyColor(),
              facing
            )
            this.context.requestRender()
          }
        } else {
          renderCharacterPreview()
        }
      }

      bodyWidthInput.addEventListener('input', () => {
        updateCharacterVisualFromInputs()
        renderCharacterPreview()
      })
      bodyHeightInput.addEventListener('input', () => {
        updateCharacterVisualFromInputs()
        renderCharacterPreview()
      })
      facingSelect.addEventListener('change', () => {
        updateCharacterVisualFromInputs()
        renderCharacterPreview()
      })

      renderCharacterPreview()

      confirmBtn.addEventListener('click', () => {
        const bodyWidthVal = Number.parseFloat(bodyWidthInput.value)
        const bodyHeightVal = Number.parseFloat(bodyHeightInput.value)
        const radius =
          Number.isFinite(bodyWidthVal) && bodyWidthVal > 0
            ? bodyWidthVal / 2
            : options.data.radius
        const bodyHeight =
          Number.isFinite(bodyHeightVal) && bodyHeightVal > 0
            ? bodyHeightVal
            : 0
        const facing = Number.parseInt(facingSelect.value, 10)
        const maxHealth = Number.parseFloat(healthInput.value)
        const maxPosture = Number.parseFloat(postureInput.value)
        const maxToughness = Number.parseFloat(toughnessInput.value)
        const debugNoDamage = debugNoDamageSelect.value === '1'
        const debugNoDeath = debugNoDeathSelect.value === '1'
        const redTapeEnabled = redTapeCheckbox?.checked
        const retreatEnabled = retreatEnabledCheckbox?.checked
        const canBeFollower = canBeFollowerCheckbox?.checked
        const retreatDelaySec =
          retreatDelayInput !== null
            ? Number.parseFloat(retreatDelayInput.value)
            : undefined
        const color = getBodyColor()
        const initialNormalMovesetId =
          initialAttackModuleSelect.value as NormalAttackMovesetId
        const moveSpeed = speedInput ? Number.parseFloat(speedInput.value) : 0
        const attackDesire = desireInput
          ? Number.parseFloat(desireInput.value)
          : 0
        const parryProficiency = parryInput
          ? Number.parseFloat(parryInput.value)
          : 0
        const initialPatrolMode = patrolSelect
          ? (patrolSelect.value as NpcPatrolMode)
          : undefined
        const detectionRangeLevel = detectionRangeSelect
          ? (detectionRangeSelect.value as NpcDetectionRangeLevel)
          : undefined

        if (
          !Number.isFinite(radius) ||
          radius <= 0 ||
          !Number.isFinite(bodyHeight) ||
          bodyHeight < 0 ||
          !Number.isFinite(maxHealth) ||
          maxHealth <= 0 ||
          !Number.isFinite(maxPosture) ||
          maxPosture < 0 ||
          !Number.isFinite(maxToughness) ||
          maxToughness < 0
        ) {
          return
        }
        if (options.showMoveSpeed) {
          if (!Number.isFinite(moveSpeed) || moveSpeed < 0) {
            return
          }
        }
        if (options.showAttackDesire) {
          if (!Number.isFinite(attackDesire) || attackDesire < 0) {
            return
          }
        }
        if (options.showParry) {
          if (!Number.isFinite(parryProficiency) || parryProficiency < 0) {
            return
          }
        }

        let mainWeaponType: WeaponType | undefined
        let mainWeaponConfig: MapNpcWeapon | undefined
        let mainWeaponMarker: WeaponMarker | undefined
        if (mainBinding && mainWeaponSelect) {
          const mainVal = mainWeaponSelect.value
          if (mainVal && mainVal !== 'none') {
            const weaponType = mainVal as WeaponType
            mainWeaponType = weaponType
            mainWeaponMarker =
              mainBinding.ensureWeaponMarker(weaponType) ?? undefined
            mainBinding.setWeaponType(weaponType)
            if (mainWeaponMarker) {
              mainBinding.setWeaponMarker(mainWeaponMarker)
              mainWeaponConfig = this.serializeWeaponMarker(mainWeaponMarker)
            } else if (
              options.data.mainWeaponConfig?.weaponType === weaponType
            ) {
              mainWeaponConfig = options.data.mainWeaponConfig
            }
          } else {
            const marker = mainBinding.getWeaponMarker()
            if (marker) {
              this.context.weaponMarkerMap.delete(marker)
            }
            mainBinding.setWeaponMarker(undefined)
            mainBinding.setWeaponType(undefined)
          }
        }

        let secondaryWeaponType: WeaponType | undefined
        let secondaryWeaponConfig: MapNpcWeapon | undefined
        let secondaryWeaponMarker: WeaponMarker | undefined
        if (secondaryBinding && secondaryWeaponSelect) {
          const secondaryVal = secondaryWeaponSelect.value
          if (secondaryVal && secondaryVal !== 'none') {
            const weaponType = secondaryVal as WeaponType
            secondaryWeaponType = weaponType
            secondaryWeaponMarker =
              secondaryBinding.ensureWeaponMarker(weaponType) ?? undefined
            secondaryBinding.setWeaponType(weaponType)
            if (secondaryWeaponMarker) {
              secondaryBinding.setWeaponMarker(secondaryWeaponMarker)
              secondaryWeaponConfig = this.serializeWeaponMarker(
                secondaryWeaponMarker
              )
            } else if (
              options.data.secondaryWeaponConfig?.weaponType === weaponType
            ) {
              secondaryWeaponConfig = options.data.secondaryWeaponConfig
            }
          } else {
            const marker = secondaryBinding.getWeaponMarker()
            if (marker) {
              this.context.weaponMarkerMap.delete(marker)
            }
            secondaryBinding.setWeaponMarker(undefined)
            secondaryBinding.setWeaponType(undefined)
          }
        }

        options.onCommit({
          radius,
          bodyHeight,
          bodyProfile,
          moveSpeed: options.showMoveSpeed ? moveSpeed : undefined,
          attackDesire: options.showAttackDesire ? attackDesire : undefined,
          parryProficiency: options.showParry ? parryProficiency : undefined,
          initialPatrolMode: options.showPatrol ? initialPatrolMode : undefined,
          detectionRangeLevel: options.showDetectionRange
            ? detectionRangeLevel
            : undefined,
          facing,
          initialNormalMovesetId,
          attackMoves: buildAttackMoveValues
            ? buildAttackMoveValues()
            : undefined,
          maxHealth,
          maxPosture,
          maxToughness,
          color,
          debugNoDamage,
          debugNoDeath,
          redTapeEnabled,
          retreatEnabled,
          retreatDelaySec,
          canBeFollower,
          factionId: factionSelectEl.value,
          npcFactions: getNpcFactionSelected(),
          allyFactions: getAllyFactionSelected(),
          drops: buildNpcDropValues ? buildNpcDropValues() : undefined,
          mainWeaponType,
          mainWeaponConfig,
          mainWeaponMarker,
          secondaryWeaponType,
          secondaryWeaponConfig,
          secondaryWeaponMarker,
        })

        this.context.requestRender()
        committed = true
        if (options.captureHistoryOnCommit !== false) {
          this.context.onHistoryCapture()
        }
        finish()
      })

      const closeDialog = () => {
        if (!committed && baseSnapshot) {
          this.context.applyMapSnapshot(baseSnapshot)
        }
        finish()
      }

      cancelBtn.addEventListener('click', closeDialog)

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeDialog()
        }
      })

      const viewport = document.getElementById('gameViewport')
      if (!viewport) {
        resolve()
        return
      }
      dialog.show(viewport)
    })
  }

  public async showNpcPropertiesDialog(marker: NpcMarker) {
    const data = this.context.npcMarkerMap.get(marker)
    if (!data) {
      return
    }
    const editorData = this.context.editorObjectMap.get(marker)
    const npcTypeLocal = localizer.t(`editor_enemy_${data.npcType}`)
    const objectName = editorData?.name ?? ''
    const mainBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_main'),
      slot: 'main',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_sword'), value: 'sword' },
        { label: localizer.t('editor_weapon_spear'), value: 'spear' },
        { label: localizer.t('editor_weapon_hammer'), value: 'hammer' },
      ],
      defaultBowAmmo: getDefaultNpcAmmoForWeaponType('sword'),
      getWeaponType: () => data.mainWeapon,
      setWeaponType: (weaponType) => {
        data.mainWeapon = weaponType
        marker.mainWeapon = weaponType
      },
      getWeaponMarker: () => data.mainWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        data.mainWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        this.context.getOrCreateNpcWeaponMarker(data, weaponType, 'main'),
    }
    const secondaryBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_secondary'),
      slot: 'secondary',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_bow'), value: 'bow' },
        { label: localizer.t('editor_weapon_grape'), value: 'grape' },
        { label: localizer.t('editor_weapon_bomb'), value: 'bomb' },
      ],
      defaultBowAmmo: getDefaultNpcAmmoForWeaponType('grape'),
      getWeaponType: () => data.secondaryWeapon,
      setWeaponType: (weaponType) => {
        data.secondaryWeapon = weaponType
        marker.secondaryWeapon = weaponType
      },
      getWeaponMarker: () => data.secondaryWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        data.secondaryWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        this.context.getOrCreateNpcWeaponMarker(data, weaponType, 'secondary'),
    }

    await this.showCharacterPropertiesDialog({
      title: `[${npcTypeLocal}] ${objectName}`,
      marker,
      data,
      attackMovesetOwner: 'npc',
      showMoveSpeed: true,
      showAttackDesire: true,
      showParry: true,
      showPatrol: true,
      showRedTape: true,
      showRetreat: true,
      showDetectionRange: true,
      showCanBeFollower: true,
      showDrops: true,
      showAttackMoves: true,
      weaponBindings: [mainBinding, secondaryBinding],
      updateMarkerVisual: (m, r, bh, c, f) =>
        this.context.updateNpcMarkerVisual(m as NpcMarker, r, bh, c, f),
      onCommit: (values) => {
        data.radius = values.radius
        data.bodyHeight = values.bodyHeight
        data.bodyProfile = values.bodyProfile
        data.moveSpeed = values.moveSpeed ?? data.moveSpeed
        data.attackDesire = values.attackDesire ?? data.attackDesire
        data.parryProficiency = values.parryProficiency ?? data.parryProficiency
        data.initialPatrolMode =
          values.initialPatrolMode ?? data.initialPatrolMode
        data.detectionRangeLevel =
          values.detectionRangeLevel ?? data.detectionRangeLevel
        data.maxHealth = values.maxHealth
        data.maxPosture = values.maxPosture
        data.maxToughness = values.maxToughness
        data.color = values.color
        data.facing = values.facing
        data.initialNormalMovesetId = values.initialNormalMovesetId
        if (values.attackMoves !== undefined) {
          data.attackMoves = values.attackMoves
          marker.attackMoves = values.attackMoves
        }
        data.debugNoDamage = values.debugNoDamage
        data.debugNoDeath = values.debugNoDeath
        if (values.redTapeEnabled !== undefined) {
          data.redTapeEnabled = values.redTapeEnabled
        }
        if (values.retreatEnabled !== undefined) {
          data.retreatEnabled = values.retreatEnabled
        }
        if (
          values.retreatDelaySec !== undefined &&
          Number.isFinite(values.retreatDelaySec)
        ) {
          data.retreatDelaySec = Math.max(0, values.retreatDelaySec)
        }
        if (values.canBeFollower !== undefined) {
          data.canBeFollower = values.canBeFollower
        }
        data.factionId = values.factionId
        data.npcFactions = values.npcFactions
        data.allyFactions = values.allyFactions
        data.drops = normalizeNpcDropList(values.drops)

        data.mainWeapon = values.mainWeaponType
        data.mainWeaponConfig = values.mainWeaponConfig
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
        data.secondaryWeaponConfig = values.secondaryWeaponConfig
        data.secondaryWeaponMarker = values.secondaryWeaponMarker
        data.equipWeapon = !!data.mainWeapon || !!data.secondaryWeapon

        marker.radius = data.radius
        marker.bodyHeight = data.bodyHeight
        marker.bodyProfile = data.bodyProfile
        marker.moveSpeed = data.moveSpeed
        marker.attackDesire = data.attackDesire
        marker.parryProficiency = data.parryProficiency
        marker.initialPatrolMode = data.initialPatrolMode
        marker.detectionRangeLevel = data.detectionRangeLevel
        marker.maxHealth = data.maxHealth
        marker.maxPosture = data.maxPosture
        marker.maxToughness = data.maxToughness
        marker.color = data.color
        marker.facing = data.facing
        marker.initialNormalMovesetId = data.initialNormalMovesetId
        marker.debugNoDamage = data.debugNoDamage
        marker.debugNoDeath = data.debugNoDeath
        marker.redTapeEnabled = data.redTapeEnabled
        marker.retreatEnabled = data.retreatEnabled
        marker.retreatDelaySec = data.retreatDelaySec
        marker.canBeFollower = data.canBeFollower
        marker.equipWeapon = data.equipWeapon
        marker.mainWeapon = data.mainWeapon
        marker.secondaryWeapon = data.secondaryWeapon
        marker.factionId = data.factionId
        marker.npcFactions = data.npcFactions
        marker.allyFactions = data.allyFactions
        marker.drops = data.drops

        this.context.updateNpcMarkerVisual(
          marker,
          data.radius,
          data.bodyHeight,
          data.color,
          data.facing
        )
      },
    })
  }

  private async showNpcTemplateDialog(
    template: MapNpcTemplate,
    confirmLabel: string
  ): Promise<MapNpcTemplate | null> {
    const defaultData = CHARACTER_DEFAULT_DATA.default
    const trackedMarkers: WeaponMarker[] = []
    let mainWeaponType: WeaponType | undefined = template.mainWeapon?.weaponType
    let mainWeaponMarker: WeaponMarker | undefined = template.mainWeapon
      ? this.createDetachedWeaponMarker(
          template.mainWeapon.weaponType,
          'main',
          trackedMarkers,
          template.mainWeapon
        )
      : undefined
    let secondaryWeaponType: WeaponType | undefined =
      template.secondaryWeapon?.weaponType
    let secondaryWeaponMarker: WeaponMarker | undefined =
      template.secondaryWeapon
        ? this.createDetachedWeaponMarker(
            template.secondaryWeapon.weaponType,
            'secondary',
            trackedMarkers,
            template.secondaryWeapon
          )
        : undefined
    let result: MapNpcTemplate | null = null

    const ensureDetachedWeaponMarker = (
      weaponType: WeaponType,
      slot: 'main' | 'secondary',
      currentMarker: WeaponMarker | undefined
    ): WeaponMarker => {
      const markerData = currentMarker
        ? this.context.weaponMarkerMap.get(currentMarker)
        : undefined
      if (currentMarker && markerData?.weaponType === weaponType) {
        return currentMarker
      }
      this.removeDetachedWeaponMarker(currentMarker, trackedMarkers)
      const initialData =
        markerData && markerData.weaponType === weaponType
          ? this.serializeWeaponMarker(currentMarker)
          : undefined
      return this.createDetachedWeaponMarker(
        weaponType,
        slot,
        trackedMarkers,
        initialData
      )
    }

    const mainBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_main'),
      slot: 'main',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_sword'), value: 'sword' },
        { label: localizer.t('editor_weapon_spear'), value: 'spear' },
        { label: localizer.t('editor_weapon_hammer'), value: 'hammer' },
      ],
      defaultBowAmmo: getDefaultNpcAmmoForWeaponType('sword'),
      getWeaponType: () => mainWeaponType,
      setWeaponType: (weaponType) => {
        mainWeaponType = weaponType
      },
      getWeaponMarker: () => mainWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        mainWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        ensureDetachedWeaponMarker(weaponType, 'main', mainWeaponMarker),
    }

    const secondaryBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_secondary'),
      slot: 'secondary',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_bow'), value: 'bow' },
        { label: localizer.t('editor_weapon_grape'), value: 'grape' },
        { label: localizer.t('editor_weapon_bomb'), value: 'bomb' },
      ],
      defaultBowAmmo: getDefaultNpcAmmoForWeaponType('grape'),
      getWeaponType: () => secondaryWeaponType,
      setWeaponType: (weaponType) => {
        secondaryWeaponType = weaponType
      },
      getWeaponMarker: () => secondaryWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        secondaryWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        ensureDetachedWeaponMarker(
          weaponType,
          'secondary',
          secondaryWeaponMarker
        ),
    }

    try {
      await this.showCharacterPropertiesDialog({
        title: `[${localizer.t('editor_npc_template_group')}] ${template.name}`,
        data: {
          radius: template.radius ?? defaultData.radius,
          bodyHeight: template.bodyHeight ?? 0,
          bodyProfile: template.bodyProfile,
          moveSpeed: template.moveSpeed ?? defaultData.moveSpeed,
          attackDesire: template.attackDesire ?? defaultData.attackDesire,
          parryProficiency:
            template.parryProficiency ?? defaultData.parryProficiency,
          initialPatrolMode:
            template.initialPatrolMode ?? defaultData.initialPatrolMode,
          detectionRangeLevel: template.detectionRangeLevel ?? 'near',
          maxHealth: template.maxHealth ?? defaultData.maxHealth,
          maxPosture: template.maxPosture ?? defaultData.maxPosture,
          maxToughness: template.maxToughness ?? defaultData.maxToughness,
          color: template.color ?? defaultData.color,
          facing: template.facing ?? 1,
          initialNormalMovesetId:
            template.initialNormalMovesetId ??
            getDefaultNormalAttackMovesetId('npc'),
          attackMoves:
            template.attackMoves ?? buildDefaultNpcAttackMoves(mainWeaponType),
          debugNoDamage: template.debugNoDamage === true,
          debugNoDeath: template.debugNoDeath === true,
          redTapeEnabled: template.redTapeEnabled === true,
          retreatEnabled: template.retreatEnabled === true,
          retreatDelaySec: template.retreatDelaySec ?? 0,
          canBeFollower: template.canBeFollower === true,
          factionId: template.factionId ?? Faction.Enemy,
          npcFactions: template.npcFactions ?? [Faction.Player],
          allyFactions: template.allyFactions ?? [],
          drops:
            template.drops === undefined
              ? undefined
              : normalizeNpcDropList(template.drops),
        },
        attackMovesetOwner: 'npc',
        showMoveSpeed: true,
        showAttackDesire: true,
        showParry: true,
        showPatrol: true,
        showRedTape: true,
        showRetreat: true,
        showDetectionRange: true,
        showCanBeFollower: true,
        showDrops: true,
        showAttackMoves: true,
        confirmLabel,
        useMapSnapshot: false,
        captureHistoryOnCommit: false,
        weaponBindings: [mainBinding, secondaryBinding],
        updateMarkerVisual: () => {},
        onCommit: (values) => {
          result = {
            ...template,
            radius: values.radius,
            bodyHeight: values.bodyHeight,
            bodyProfile: values.bodyProfile,
            moveSpeed: values.moveSpeed,
            attackDesire: values.attackDesire,
            parryProficiency: values.parryProficiency,
            initialPatrolMode: values.initialPatrolMode,
            detectionRangeLevel: values.detectionRangeLevel,
            maxHealth: values.maxHealth,
            maxPosture: values.maxPosture,
            maxToughness: values.maxToughness,
            color: values.color,
            facing: values.facing,
            initialNormalMovesetId: values.initialNormalMovesetId,
            attackMoves: values.attackMoves,
            debugNoDamage: values.debugNoDamage,
            debugNoDeath: values.debugNoDeath,
            redTapeEnabled: values.redTapeEnabled,
            retreatEnabled: values.retreatEnabled,
            retreatDelaySec: values.retreatDelaySec,
            canBeFollower: values.canBeFollower,
            equipWeapon:
              !!values.mainWeaponType || !!values.secondaryWeaponType,
            mainWeapon: this.serializeWeaponMarker(values.mainWeaponMarker),
            secondaryWeapon: this.serializeWeaponMarker(
              values.secondaryWeaponMarker
            ),
            factionId: values.factionId,
            npcFactions: values.npcFactions,
            allyFactions: values.allyFactions,
            drops: normalizeNpcDropList(values.drops),
          }
        },
      })
    } finally {
      for (let i = trackedMarkers.length - 1; i >= 0; i--) {
        this.context.weaponMarkerMap.delete(trackedMarkers[i])
      }
    }

    return result
  }

  public async showNpcTemplateCreationDialog(options: {
    id: string
    name: string
  }): Promise<MapNpcTemplate | null> {
    return await this.showNpcTemplateDialog(
      {
        id: options.id,
        name: options.name,
        npcType: 'default',
      },
      localizer.t('editor_npc_template_save')
    )
  }

  public async showNpcTemplateEditDialog(
    template: MapNpcTemplate
  ): Promise<MapNpcTemplate | null> {
    return await this.showNpcTemplateDialog(
      template,
      localizer.t('editor_npc_template_update')
    )
  }

  public async showPlayerPropertiesDialog(marker: PlayerMarker) {
    const data = this.context.playerMarkerData()
    if (!data || data.marker !== marker) {
      return
    }
    const editorData = this.context.editorObjectMap.get(marker)
    const objectName = editorData?.name ?? ''
    const mainBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_main'),
      slot: 'main',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_sword'), value: 'sword' },
        { label: localizer.t('editor_weapon_spear'), value: 'spear' },
        { label: localizer.t('editor_weapon_hammer'), value: 'hammer' },
      ],
      defaultBowAmmo: getDefaultPlayerAmmoForWeaponType('sword'),
      getWeaponType: () => data.mainWeapon,
      setWeaponType: (weaponType) => {
        data.mainWeapon = weaponType
      },
      getWeaponMarker: () => data.mainWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        data.mainWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        this.context.getOrCreatePlayerWeaponMarker(data, weaponType, 'main'),
    }
    const secondaryBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_secondary'),
      slot: 'secondary',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_bow'), value: 'bow' },
        { label: localizer.t('editor_weapon_grape'), value: 'grape' },
        { label: localizer.t('editor_weapon_bomb'), value: 'bomb' },
      ],
      defaultBowAmmo: getDefaultPlayerAmmoForWeaponType('grape'),
      getWeaponType: () => data.secondaryWeapon,
      setWeaponType: (weaponType) => {
        data.secondaryWeapon = weaponType
      },
      getWeaponMarker: () => data.secondaryWeaponMarker,
      setWeaponMarker: (weaponMarker) => {
        data.secondaryWeaponMarker = weaponMarker
      },
      ensureWeaponMarker: (weaponType) =>
        this.context.getOrCreatePlayerWeaponMarker(
          data,
          weaponType,
          'secondary'
        ),
    }

    await this.showCharacterPropertiesDialog({
      title: `[${localizer.t('editor_object_player')}] ${objectName}`,
      marker,
      data,
      attackMovesetOwner: 'player',
      showMoveSpeed: true,
      showAttackDesire: false,
      showParry: false,
      showPatrol: false,
      weaponBindings: [mainBinding, secondaryBinding],
      updateMarkerVisual: (m, r, bh, c, f) =>
        this.context.updatePlayerMarkerVisual(m as PlayerMarker, r, bh, c, f),
      onCommit: (values) => {
        data.radius = values.radius
        data.bodyHeight = values.bodyHeight
        data.bodyProfile = values.bodyProfile
        data.moveSpeed = values.moveSpeed ?? data.moveSpeed
        data.maxHealth = values.maxHealth
        data.maxPosture = values.maxPosture
        data.maxToughness = values.maxToughness
        data.color = values.color
        data.facing = values.facing
        data.initialNormalMovesetId = values.initialNormalMovesetId
        data.debugNoDamage = values.debugNoDamage
        data.debugNoDeath = values.debugNoDeath
        data.factionId = values.factionId
        data.npcFactions = values.npcFactions
        data.allyFactions = values.allyFactions

        data.mainWeapon = values.mainWeaponType
        data.mainWeaponConfig = values.mainWeaponConfig
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
        data.secondaryWeaponConfig = values.secondaryWeaponConfig
        data.secondaryWeaponMarker = values.secondaryWeaponMarker

        marker.radius = data.radius
        marker.bodyHeight = data.bodyHeight
        marker.bodyProfile = data.bodyProfile
        marker.maxHealth = data.maxHealth
        marker.maxPosture = data.maxPosture
        marker.maxToughness = data.maxToughness
        marker.color = data.color
        marker.facing = data.facing
        marker.initialNormalMovesetId = data.initialNormalMovesetId
        marker.debugNoDamage = data.debugNoDamage
        marker.debugNoDeath = data.debugNoDeath
        marker.factionId = data.factionId
        marker.npcFactions = data.npcFactions
        marker.allyFactions = data.allyFactions

        this.context.updatePlayerMarkerVisual(
          marker,
          data.radius,
          data.bodyHeight,
          data.color,
          data.facing
        )
      },
    })
  }

  public async showWeaponPropertiesDialog(
    marker: WeaponMarker,
    options?: WeaponPropertiesDialogOptions
  ) {
    let data = this.context.weaponMarkerMap.get(marker)
    if (!data) {
      const weaponType = marker.weaponType
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const sizeLevel = marker.sizeLevel ?? template.sizeLevel
      const resolvedStats = resolveWeaponStatsForSize(
        template,
        sizeLevel,
        {
          attackDamage: marker.attackDamage,
          postureDamage: marker.postureDamage,
          toughnessDamage: marker.toughnessDamage,
        },
        true
      )
      const category =
        marker.category ??
        (isSecondaryWeaponType(weaponType) ? 'secondary' : 'main')
      data = {
        marker,
        weaponType,
        category,
        sizeLevel,
        attackDamage: resolvedStats.attackDamage,
        postureDamage: resolvedStats.postureDamage,
        toughnessDamage: resolvedStats.toughnessDamage,
        bowAmmo: isAmmoLimitedWeaponType(weaponType)
          ? (marker.bowAmmo ?? getDefaultPlayerAmmoForWeaponType(weaponType))
          : undefined,
      }
      this.context.weaponMarkerMap.set(marker, data)
    }
    const baseSnapshot =
      options?.useMapSnapshot === false ? null : this.context.getMapSnapshot()
    let committed = false

    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'
    const isRanged = isAmmoLimitedWeaponType(marker.weaponType)

    const getSizeName = (level: number): string => {
      if (isBow) {
        return level === 1
          ? localizer.t('editor_weapon_size_bow_1')
          : localizer.t('editor_weapon_size_bow_2')
      } else if (marker.weaponType === 'bomb') {
        return localizer.t('editor_weapon_size_bomb_1')
      } else if (marker.weaponType === 'grape') {
        return localizer.t('editor_weapon_size_grape_1')
      } else if (marker.weaponType === 'hammer') {
        return level === 1
          ? localizer.t('editor_weapon_size_hammer_1')
          : localizer.t('editor_weapon_size_hammer_2')
      } else if (marker.weaponType === 'spear') {
        return localizer.t('editor_weapon_size_spear_1')
      } else {
        switch (level) {
          case 1:
            return localizer.t('editor_weapon_size_sword_1')
          case 2:
            return localizer.t('editor_weapon_size_sword_2')
          case 3:
            return localizer.t('editor_weapon_size_sword_3')
          case 4:
            return localizer.t('editor_weapon_size_sword_4')
          default:
            return String(level)
        }
      }
    }

    const editorData = this.context.editorObjectMap.get(marker)
    const weaponCategoryName = localizer.t(`editor_weapon_${data.weaponType}`)
    const objectName = editorData?.name ?? ''
    const dialog = EditorUIHelper.createPropertiesDialog(
      `[${weaponCategoryName}] ${objectName}`
    )
    const { leftPanel, footerPanel, previewCanvas, previewCtx, close, modal } =
      dialog

    const sizeOptions: Array<{ value: string; label: string }> = []
    for (let i = 1; i <= template.sizeMaxLevel; i++) {
      sizeOptions.push({
        value: String(i),
        label: `${i} - ${getSizeName(i)}`,
      })
    }
    const sizeRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_size')
    )
    const sizeSelect = EditorUIHelper.createSelect({
      options: sizeOptions,
      selected: String(data.sizeLevel),
    })
    sizeRow.row.appendChild(sizeSelect)
    leftPanel.appendChild(sizeRow.row)

    const attackRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_attack_damage')
    )
    const attackInput = EditorUIHelper.createNumberInput({
      value: data.attackDamage,
      min: '0',
      step: '0.1',
    })
    attackRow.row.appendChild(attackInput)
    leftPanel.appendChild(attackRow.row)

    const postureRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_posture_damage')
    )
    const postureInput = EditorUIHelper.createNumberInput({
      value: data.postureDamage,
      min: '0',
      step: '0.1',
    })
    postureRow.row.appendChild(postureInput)
    leftPanel.appendChild(postureRow.row)

    const toughnessRow = EditorUIHelper.createFormRow(
      localizer.t('editor_weapon_prop_toughness_damage')
    )
    const toughnessInput = EditorUIHelper.createNumberInput({
      value: data.toughnessDamage,
      min: '0',
      step: '0.1',
    })
    toughnessRow.row.appendChild(toughnessInput)
    leftPanel.appendChild(toughnessRow.row)

    let bowAmmoInput: HTMLInputElement | null = null
    if (isRanged) {
      const ammoRow = EditorUIHelper.createFormRow(
        localizer.t('editor_weapon_prop_bow_ammo')
      )
      bowAmmoInput = EditorUIHelper.createNumberInput({
        value:
          data.bowAmmo ?? getDefaultPlayerAmmoForWeaponType(marker.weaponType),
        min: '0',
        step: '1',
      })
      ammoRow.row.appendChild(bowAmmoInput)
      leftPanel.appendChild(ammoRow.row)
    }

    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    footerPanel.appendChild(buttonRow)

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return
    }
    dialog.show(viewport)

    const renderWeaponPreview = () => {
      if (!previewCtx) {
        return
      }
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)

      const sizeLevel = Number.parseInt(sizeSelect.value, 10)
      const pixelsPerMeter = 60
      const dims = computeWeaponRenderDimensions(
        template,
        sizeLevel,
        pixelsPerMeter,
        isBow
      )
      const centerX = previewCanvas.width * 0.5
      const centerY = previewCanvas.height * 0.6
      const previewType = this.getWeaponRenderType(marker.weaponType)
      const previewColor = '#b4bdc7'

      previewCtx.save()
      previewCtx.translate(centerX, centerY)
      previewCtx.rotate(getWeaponGroundRotationRad(marker.weaponType))
      renderWeapon(
        previewCtx,
        previewType,
        dims.widthPx,
        dims.heightPx,
        previewColor
      )
      previewCtx.restore()
    }

    sizeSelect.addEventListener('input', () => {
      const sizeLevel = Number.parseInt(sizeSelect.value, 10)
      if (Number.isFinite(sizeLevel) && sizeLevel > 0) {
        const nextStats = resolveWeaponStatsForSize(template, sizeLevel)
        attackInput.value = String(nextStats.attackDamage)
        postureInput.value = String(nextStats.postureDamage)
        toughnessInput.value = String(nextStats.toughnessDamage)
        this.context.updateWeaponMarkerVisual(marker, sizeLevel)
        this.context.requestRender()
      }
      renderWeaponPreview()
    })
    attackInput.addEventListener('input', renderWeaponPreview)
    postureInput.addEventListener('input', renderWeaponPreview)
    toughnessInput.addEventListener('input', renderWeaponPreview)
    if (bowAmmoInput) {
      bowAmmoInput.addEventListener('input', renderWeaponPreview)
    }
    renderWeaponPreview()

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        if (!committed && baseSnapshot) {
          this.context.applyMapSnapshot(baseSnapshot)
        }
        close()
        resolve()
      }

      confirmBtn.addEventListener('click', () => {
        const sizeLevel = Number.parseInt(sizeSelect.value, 10)
        const attackDamage = Number.parseFloat(attackInput.value)
        const postureDamage = Number.parseFloat(postureInput.value)
        const toughnessDamage = Number.parseFloat(toughnessInput.value)
        const bowAmmo = bowAmmoInput
          ? Number.parseInt(bowAmmoInput.value, 10)
          : data.bowAmmo

        if (
          !Number.isFinite(sizeLevel) ||
          !Number.isFinite(attackDamage) ||
          !Number.isFinite(postureDamage) ||
          !Number.isFinite(toughnessDamage)
        ) {
          cleanup()
          return
        }

        if (bowAmmoInput && !Number.isFinite(bowAmmo)) {
          cleanup()
          return
        }

        data.sizeLevel = sizeLevel
        data.attackDamage = attackDamage
        data.postureDamage = postureDamage
        data.toughnessDamage = toughnessDamage
        if (bowAmmoInput) {
          data.bowAmmo = bowAmmo
        }

        marker.sizeLevel = sizeLevel
        marker.attackDamage = attackDamage
        marker.postureDamage = postureDamage
        marker.toughnessDamage = toughnessDamage
        if (bowAmmoInput) {
          marker.bowAmmo = bowAmmo
        }

        this.context.updateWeaponMarkerVisual(marker, sizeLevel)
        this.context.requestRender()
        committed = true
        if (options?.captureHistoryOnCommit !== false) {
          this.context.onHistoryCapture()
        }
        cleanup()
      })

      cancelBtn.addEventListener('click', cleanup)
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup()
        }
      })
    })
  }

  public async showCommonPropertiesDialog(
    targetOrTargets: fabric.Object | readonly fabric.Object[]
  ): Promise<boolean> {
    const targets = Array.isArray(targetOrTargets)
      ? targetOrTargets
      : [targetOrTargets]
    if (targets.length === 0) {
      return false
    }
    const dialog = EditorUIHelper.createPropertiesDialog(
      localizer.t('editor_common_properties_title')
    )
    const { leftPanel, rightPanel, footerPanel, previewCanvas, modal, close } =
      dialog

    previewCanvas.style.display = 'none'

    const renderLayerRow = EditorUIHelper.createFormRow(
      localizer.t('editor_common_properties_render_layer')
    )
    let sharedRenderLayer: number | null = this.context.getCommonRenderLayer(
      targets[0]
    )
    for (let i = 1; i < targets.length; i++) {
      const layer = this.context.getCommonRenderLayer(targets[i])
      if (layer !== sharedRenderLayer) {
        sharedRenderLayer = null
        break
      }
    }
    const renderLayerInput = EditorUIHelper.createNumberInput({
      value: sharedRenderLayer === null ? '' : sharedRenderLayer,
      step: '1',
    })
    if (sharedRenderLayer === null) {
      renderLayerInput.placeholder = localizer.t(
        'editor_common_properties_mixed_placeholder'
      )
    }
    renderLayerRow.row.appendChild(renderLayerInput)
    leftPanel.appendChild(renderLayerRow.row)

    const availableRenderLayers = this.context.getAvailableRenderLayers()
    const renderLayerSelectRow = EditorUIHelper.createFormRow(
      localizer.t('editor_common_properties_render_layer_existing')
    )
    const renderLayerSelect = EditorUIHelper.createSelect({
      options: [
        {
          value: '',
          label: localizer.t(
            'editor_common_properties_render_layer_existing_placeholder'
          ),
        },
        ...availableRenderLayers.map((layer) => ({
          value: String(layer),
          label: formatRenderLayerLabel(layer),
        })),
      ],
      selected:
        sharedRenderLayer !== null &&
        availableRenderLayers.includes(sharedRenderLayer)
          ? String(sharedRenderLayer)
          : '',
    })
    renderLayerSelect.style.flex = '1 1 auto'
    renderLayerSelect.style.width = '200px'
    renderLayerSelect.addEventListener('change', () => {
      const nextValue = renderLayerSelect.value
      if (nextValue.length > 0) {
        renderLayerInput.value = nextValue
      }
    })
    renderLayerInput.addEventListener('input', () => {
      const currentValue = renderLayerInput.value.trim()
      renderLayerSelect.value = availableRenderLayers.some(
        (layer) => String(layer) === currentValue
      )
        ? currentValue
        : ''
    })
    renderLayerSelectRow.row.appendChild(renderLayerSelect)
    leftPanel.appendChild(renderLayerSelectRow.row)

    const hint = document.createElement('div')
    hint.textContent = localizer.t('editor_common_properties_render_layer_hint')
    hint.style.cssText =
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.62);'
    rightPanel.appendChild(hint)
    if (targets.length > 1) {
      const batchHint = document.createElement('div')
      batchHint.textContent = localizer.t('editor_common_properties_batch_hint')
      batchHint.style.cssText =
        'margin-top:8px;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.62);'
      rightPanel.appendChild(batchHint)
    }

    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    footerPanel.appendChild(buttonRow)

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return false
    }
    return await new Promise<boolean>((resolve) => {
      dialog.show(viewport)

      const finish = (changed: boolean) => {
        close()
        resolve(changed)
      }

      confirmBtn.addEventListener('click', () => {
        const renderLayerText = renderLayerInput.value.trim()
        let changed = false
        if (renderLayerText.length > 0) {
          const renderLayer = Number.parseInt(renderLayerText, 10)
          if (!Number.isFinite(renderLayer)) {
            finish(false)
            return
          }
          for (let i = 0; i < targets.length; i++) {
            changed =
              this.context.setCommonRenderLayer(targets[i], renderLayer) ||
              changed
          }
        }
        if (changed) {
          this.context.requestRender()
        }
        finish(changed)
      })

      cancelBtn.addEventListener('click', () => finish(false))
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          finish(false)
        }
      })
    })
  }

  public async showTerrainPropertiesDialog(
    target: fabric.Object
  ): Promise<boolean> {
    const straightEdgeValue = this.context.getTerrainStraightEdge(target)
    if (straightEdgeValue === null) {
      return false
    }

    const dialog = EditorUIHelper.createPropertiesDialog(
      localizer.t('editor_terrain_properties_title')
    )
    const { leftPanel, rightPanel, footerPanel, previewCanvas, modal, close } =
      dialog

    previewCanvas.style.display = 'none'
    const straightEdgeRow = EditorUIHelper.createFormRow(
      localizer.t('editor_terrain_properties_straight_edge')
    )
    const straightEdgeCheckbox = document.createElement('input')
    straightEdgeCheckbox.type = 'checkbox'
    straightEdgeCheckbox.checked = straightEdgeValue
    straightEdgeRow.row.appendChild(straightEdgeCheckbox)
    leftPanel.appendChild(straightEdgeRow.row)

    const straightEdgeHint = document.createElement('div')
    straightEdgeHint.textContent = localizer.t(
      'editor_terrain_properties_straight_edge_hint'
    )
    straightEdgeHint.style.cssText =
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.62);'
    rightPanel.appendChild(straightEdgeHint)

    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    footerPanel.appendChild(buttonRow)

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return false
    }
    return await new Promise<boolean>((resolve) => {
      dialog.show(viewport)

      const finish = (changed: boolean) => {
        close()
        resolve(changed)
      }

      confirmBtn.addEventListener('click', () => {
        const changed = this.context.setTerrainStraightEdge(
          target,
          straightEdgeCheckbox.checked
        )
        if (changed) {
          this.context.requestRender()
        }
        finish(changed)
      })

      cancelBtn.addEventListener('click', () => finish(false))
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          finish(false)
        }
      })
    })
  }

  public async showMapSettingsDialog(
    settings: MapSettings
  ): Promise<MapSettings | null> {
    const dialog = EditorUIHelper.createPropertiesDialog(
      localizer.t('editor_map_settings_title')
    )
    const { leftPanel, rightPanel, footerPanel, previewCanvas, modal, close } =
      dialog

    previewCanvas.style.display = 'none'
    const initialTimeRow = EditorUIHelper.createFormRow(
      localizer.t('editor_map_settings_initial_time')
    )
    const initialTimeSelect = EditorUIHelper.createSelect({
      options: MAP_TIME_PHASE_IDS.map((phaseId) => ({
        value: phaseId,
        label: localizer.t(`editor_time_phase_${phaseId}`),
      })),
      selected: settings.initialTimePhase ?? DEFAULT_MAP_TIME_PHASE,
    })
    initialTimeSelect.style.flex = '1 1 auto'
    initialTimeSelect.style.width = '200px'
    initialTimeRow.row.appendChild(initialTimeSelect)
    leftPanel.appendChild(initialTimeRow.row)

    const hint = document.createElement('div')
    hint.textContent = localizer.t('editor_map_settings_initial_time_hint')
    hint.style.cssText =
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.62);'
    rightPanel.appendChild(hint)

    const buttonRow = EditorUIHelper.createButtonRow()
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    buttonRow.appendChild(confirmBtn)
    buttonRow.appendChild(cancelBtn)
    footerPanel.appendChild(buttonRow)

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return null
    }
    return await new Promise<MapSettings | null>((resolve) => {
      dialog.show(viewport)

      const finish = (nextSettings: MapSettings | null) => {
        close()
        resolve(nextSettings)
      }

      confirmBtn.addEventListener('click', () => {
        finish({
          initialTimePhase:
            initialTimeSelect.value as MapSettings['initialTimePhase'],
        })
      })

      cancelBtn.addEventListener('click', () => finish(null))
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          finish(null)
        }
      })
    })
  }

  private async handleCreateFaction(
    factionSelectEl: HTMLSelectElement,
    rebuildFactionCheckboxes: () => void,
    promptMessage: string
  ): Promise<void> {
    const name = await this.context.dialogManager.prompt(promptMessage)
    if (!name) {
      return
    }
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }

    this.context.addFaction(trimmed)
    const opt = document.createElement('option')
    opt.value = trimmed
    opt.textContent = trimmed
    factionSelectEl.appendChild(opt)
    factionSelectEl.value = trimmed
    rebuildFactionCheckboxes()
  }
}
