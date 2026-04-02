import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import {
  getCharacterBodyColor,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
} from '../characterBodyProfile'
import { WEAPON_DEFAULT_DATA } from '../constants'
import {
  type AttackMovesetOwner,
  NORMAL_ATTACK_MOVESET_OPTIONS,
  getDefaultAttackMovesetIdForWeaponType,
  getDefaultNormalAttackMovesetId,
  isMovesetCompatibleWithWeaponType,
} from '../ecs/AttackMoveRegistry'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import type { EditorMapData, MapCharacterBodyProfile } from '../editorMapTypes'
import {
  HUD_SLOT_SIZE,
  HUD_SLOT_SPACING,
  drawHudWeaponSlot,
} from '../renderer/HudWeaponSlotRenderer'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type {
  NormalAttackMovesetId,
  NpcDetectionRangeLevel,
  NpcPatrolMode,
  WeaponType,
} from '../types'
import {
  getDefaultNpcAmmoForWeaponType,
  getDefaultPlayerAmmoForWeaponType,
  getWeaponGroundRotationRad,
  isRangedWeaponType,
  isSecondaryWeaponType,
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
  marker: NpcMarker | PlayerMarker
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
    debugNoDamage: boolean
    debugNoDeath: boolean
    redTapeEnabled?: boolean
    retreatEnabled?: boolean
    retreatDelaySec?: number
    canBeFollower?: boolean
    factionId: string
    npcFactions: string[]
    allyFactions: string[]
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
    mainWeaponType?: WeaponType
    mainWeaponMarker?: WeaponMarker
    secondaryWeaponType?: WeaponType
    secondaryWeaponMarker?: WeaponMarker
  }) => void
}

export interface EditorPropertiesPanelContext {
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
    const textureDataUrl = profile?.surfaceDataUrl ?? profile?.textureDataUrl
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
  ): 'sword' | 'spear' | 'hammer' | 'bow' | 'grape' | 'hook' {
    if (weaponType === 'hook') {
      return 'hook'
    }
    if (weaponType === 'bow') {
      return 'bow'
    }
    if (weaponType === 'grape') {
      return 'grape'
    }
    if (weaponType === 'hammer') {
      return 'hammer'
    }
    if (weaponType === 'spear') {
      return 'spear'
    }
    return 'sword'
  }

  private async showCharacterPropertiesDialog(options: CharacterDialogOptions) {
    const baseSnapshot = this.context.getMapSnapshot()
    let committed = false

    const dialog = EditorUIHelper.createPropertiesDialog(options.title)

    const {
      leftPanel,
      rightPanel,
      footerPanel,
      previewCanvas,
      previewCtx,
      close,
      modal,
    } = dialog
    const weaponSlotsCanvas = EditorUIHelper.createPreviewCanvas({
      width: 160,
      height: 64,
    })
    weaponSlotsCanvas.style.marginTop = '12px'
    if (options.weaponBindings.length > 0) {
      rightPanel.appendChild(weaponSlotsCanvas)
    }
    const weaponSlotsCtx = weaponSlotsCanvas.getContext('2d')

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
    tabBar.appendChild(tabBtnBasic)
    tabBar.appendChild(tabBtnAppearance)
    leftPanel.appendChild(tabBar)

    const basicPanel = document.createElement('div')
    const appearancePanel = document.createElement('div')
    appearancePanel.style.display = 'none'
    leftPanel.appendChild(basicPanel)
    leftPanel.appendChild(appearancePanel)

    const switchTab = (showBasic: boolean) => {
      basicPanel.style.display = showBasic ? '' : 'none'
      appearancePanel.style.display = showBasic ? 'none' : ''
      tabBtnBasic.style.color = showBasic ? '#fff' : 'rgba(255,255,255,0.5)'
      tabBtnBasic.style.borderBottomColor = showBasic ? '#fff' : 'transparent'
      tabBtnAppearance.style.color = showBasic
        ? 'rgba(255,255,255,0.5)'
        : '#fff'
      tabBtnAppearance.style.borderBottomColor = showBasic
        ? 'transparent'
        : '#fff'
    }
    tabBtnBasic.addEventListener('click', () => switchTab(true))
    tabBtnAppearance.addEventListener('click', () => switchTab(false))

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
      const name = prompt(localizer.t('editor_faction_new_prompt'))
      if (!name || !name.trim()) return
      const trimmed = name.trim()
      this.context.addFaction(trimmed)
      const opt = document.createElement('option')
      opt.value = trimmed
      opt.textContent = trimmed
      factionSelectEl.appendChild(opt)
      factionSelectEl.value = trimmed
      rebuildFactionCheckboxes()
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
            const allyCb = allyFactionContainer.querySelector<HTMLInputElement>(
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
    factionSelectEl.addEventListener('change', () => rebuildFactionCheckboxes())

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
      const nextBodyProfile = await this.bodyDrawer.show({
        title: localizer.t('editor_body_drawer_title'),
        initialProfile: bodyProfile,
        initialColor: getCharacterBodyColor(bodyProfile, options.data.color),
        defaultBodyWidth: currentWidth,
        defaultBodyHeight: currentHeight,
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
      options.marker.bodyProfile = bodyProfile
      options.data.bodyProfile = bodyProfile
      updateCharacterVisualFromInputs()
      renderCharacterPreview()
    })
    bodyDrawRow.row.appendChild(bodyDrawBtn)
    appearancePanel.appendChild(bodyDrawRow.row)

    const mainBinding =
      options.weaponBindings.find((binding) => binding.slot === 'main') ?? null
    const secondaryBinding =
      options.weaponBindings.find((binding) => binding.slot === 'secondary') ??
      null

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
            await this.showWeaponPropertiesDialog(weaponMarker)
            renderCharacterPreview()
          }
        }
      })
      row.row.appendChild(configBtn)
      basicPanel.appendChild(row.row)

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
          }
        } else {
          const marker = binding.getWeaponMarker()
          if (marker) {
            this.context.weaponMarkerMap.delete(marker)
          }
          binding.setWeaponMarker(undefined)
          binding.setWeaponType(undefined)
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

    // Buttons
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
      _defaultBowAmmo: number
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
      slot.ammo = isRangedWeaponType(weaponType)
        ? (markerMatches?.bowAmmo ??
          getDefaultPlayerAmmoForWeaponType(weaponType))
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

      const mainAmmoValue = mainSlotPreview.ammo < 0 ? 0 : mainSlotPreview.ammo
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
        isRangedWeaponType(mainSlotPreview.weaponType)
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
        isRangedWeaponType(secondarySlotPreview.weaponType)
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
        Number.isFinite(bodyHeightVal) && bodyHeightVal > 0 ? bodyHeightVal : 0
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
      }
      if (Number.isFinite(bodyWidthVal) && bodyWidthVal > 0) {
        const radiusMeters = bodyWidthVal / 2
        const bodyHeight =
          Number.isFinite(bodyHeightVal) && bodyHeightVal > 0
            ? bodyHeightVal
            : 0
        options.updateMarkerVisual(
          options.marker,
          radiusMeters,
          bodyHeight,
          getBodyColor(),
          facing
        )
        this.context.requestRender()
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
        Number.isFinite(bodyHeightVal) && bodyHeightVal > 0 ? bodyHeightVal : 0
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
        mainWeaponType,
        mainWeaponMarker,
        secondaryWeaponType,
        secondaryWeaponMarker,
      })

      this.context.requestRender()
      committed = true
      this.context.onHistoryCapture()
      close()
    })

    const closeDialog = () => {
      if (!committed) {
        this.context.applyMapSnapshot(baseSnapshot)
      }
      close()
    }

    cancelBtn.addEventListener('click', closeDialog)

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeDialog()
      }
    })

    const viewport = document.getElementById('gameViewport')
    if (!viewport) {
      return
    }
    dialog.show(viewport)
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

        data.mainWeapon = values.mainWeaponType
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
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
        marker.factionId = data.factionId
        marker.npcFactions = data.npcFactions
        marker.allyFactions = data.allyFactions

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
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
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

  public async showWeaponPropertiesDialog(marker: WeaponMarker) {
    let data = this.context.weaponMarkerMap.get(marker)
    if (!data) {
      const weaponType = marker.weaponType
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const category =
        marker.category ??
        (isSecondaryWeaponType(weaponType) ? 'secondary' : 'main')
      data = {
        marker,
        weaponType,
        category,
        sizeLevel: marker.sizeLevel ?? template.sizeLevel,
        attackDamage:
          marker.attackDamage ??
          template.attackDamage *
            computeWeaponScaleFactor(
              template,
              marker.sizeLevel ?? template.sizeLevel
            ),
        postureDamage:
          marker.postureDamage ??
          template.postureDamage *
            computeWeaponScaleFactor(
              template,
              marker.sizeLevel ?? template.sizeLevel
            ),
        toughnessDamage:
          marker.toughnessDamage ??
          template.toughnessDamage *
            computeWeaponScaleFactor(
              template,
              marker.sizeLevel ?? template.sizeLevel
            ),
        bowAmmo: isRangedWeaponType(weaponType)
          ? (marker.bowAmmo ?? getDefaultPlayerAmmoForWeaponType(weaponType))
          : undefined,
      }
      this.context.weaponMarkerMap.set(marker, data)
    }
    const baseSnapshot = this.context.getMapSnapshot()
    let committed = false

    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'
    const isRanged = isRangedWeaponType(marker.weaponType)

    const getSizeName = (level: number): string => {
      if (isBow) {
        return level === 1
          ? localizer.t('editor_weapon_size_bow_1')
          : localizer.t('editor_weapon_size_bow_2')
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
        if (!committed) {
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
        this.context.onHistoryCapture()
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
}
