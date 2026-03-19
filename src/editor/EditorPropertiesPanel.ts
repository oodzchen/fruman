import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import {
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import {
  type AttackMovesetOwner,
  NORMAL_ATTACK_MOVESET_OPTIONS,
  getDefaultNormalAttackMovesetId,
} from '../ecs/AttackMoveRegistry'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import type { EditorMapData } from '../editorMapTypes'
import {
  HUD_SLOT_SIZE,
  HUD_SLOT_SPACING,
  drawHudWeaponSlot,
} from '../renderer/HudWeaponSlotRenderer'
import { renderWeapon } from '../renderer/WeaponRenderer'
import type {
  EnemyPatrolMode,
  NormalAttackMovesetId,
  WeaponType,
} from '../types'
import type { EditorObjectFactory } from './EditorObjectFactory'
import {
  computeWeaponRenderDimensions,
  renderEnemyPreviewToContext,
} from './EditorRenderUtils'
import { EditorUIHelper } from './EditorUIHelper'
import type {
  EditorObjectData,
  EnemyMarker,
  EnemyMarkerData,
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
  marker: EnemyMarker | PlayerMarker
  data: {
    radius: number
    moveSpeed?: number
    attackDesire?: number
    parryProficiency?: number
    initialPatrolMode?: EnemyPatrolMode
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    facing: number
    initialNormalMovesetId: NormalAttackMovesetId
    debugNoDamage: boolean
    debugNoDeath: boolean
  }
  attackMovesetOwner: AttackMovesetOwner
  showMoveSpeed: boolean
  showAttackDesire: boolean
  showParry: boolean
  showPatrol: boolean
  weaponBindings: CharacterWeaponBinding[]
  updateMarkerVisual: (
    marker: EnemyMarker | PlayerMarker,
    radiusMeters: number,
    color: string,
    facing: number
  ) => void
  onCommit: (values: {
    radius: number
    moveSpeed?: number
    attackDesire?: number
    parryProficiency?: number
    initialPatrolMode?: EnemyPatrolMode
    facing: number
    initialNormalMovesetId: NormalAttackMovesetId
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    debugNoDamage: boolean
    debugNoDeath: boolean
    mainWeaponType?: WeaponType
    mainWeaponMarker?: WeaponMarker
    secondaryWeaponType?: WeaponType
    secondaryWeaponMarker?: WeaponMarker
  }) => void
}

export interface EditorPropertiesPanelContext {
  getFabricCanvas: () => fabric.Canvas | null
  weaponMarkerMap: Map<fabric.Object, WeaponMarkerData>
  enemyMarkerMap: Map<fabric.Object, EnemyMarkerData>
  playerMarkerData: () => PlayerMarkerData | null
  editorObjectMap: Map<fabric.Object, EditorObjectData>
  objectFactory: EditorObjectFactory
  requestRender: () => void
  getMapSnapshot: () => EditorMapData
  applyMapSnapshot: (data: EditorMapData) => void
  onHistoryCapture: () => void
  getOrCreateEnemyWeaponMarker: (
    enemyData: EnemyMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ) => WeaponMarker | null
  getOrCreatePlayerWeaponMarker: (
    playerData: PlayerMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ) => WeaponMarker | null
  updateEnemyMarkerVisual: (
    marker: EnemyMarker,
    radiusMeters: number,
    color: string,
    facing: number
  ) => void
  updatePlayerMarkerVisual: (
    marker: PlayerMarker,
    radiusMeters: number,
    color: string,
    facing: number
  ) => void
  updateWeaponMarkerVisual: (marker: WeaponMarker, sizeLevel: number) => void
}

export class EditorPropertiesPanel {
  private context: EditorPropertiesPanelContext

  constructor(context: EditorPropertiesPanelContext) {
    this.context = context
  }

  private getWeaponRenderType(
    weaponType: WeaponType
  ): 'sword' | 'spear' | 'hammer' | 'bow' | 'hook' {
    if (weaponType === 'hook') {
      return 'hook'
    }
    if (weaponType === 'bow') {
      return 'bow'
    }
    if (weaponType === 'hammer' || weaponType === 'bigHammer') {
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

    // Radius
    const radiusRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_radius')
    )
    const radiusInput = EditorUIHelper.createNumberInput({
      value: options.data.radius,
      min: '0.1',
      step: '0.1',
    })
    radiusRow.row.appendChild(radiusInput)
    leftPanel.appendChild(radiusRow.row)

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
      leftPanel.appendChild(speedRow.row)
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
      leftPanel.appendChild(desireRow.row)
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
      leftPanel.appendChild(parryRow.row)
    }

    // Patrol Mode
    let patrolSelect: HTMLSelectElement | null = null
    if (options.showPatrol) {
      const patrolRow = EditorUIHelper.createFormRow(
        localizer.t('editor_enemy_prop_patrol_mode')
      )
      const patrolModes: EnemyPatrolMode[] = ['patrol', 'guard']
      patrolSelect = EditorUIHelper.createSelect({
        options: patrolModes.map((mode) => ({
          value: mode,
          label: localizer.t(`editor_enemy_patrol_${mode}`),
        })),
        selected: options.data.initialPatrolMode,
      })
      patrolRow.row.appendChild(patrolSelect)
      leftPanel.appendChild(patrolRow.row)
    }

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
    leftPanel.appendChild(facingRow.row)

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
    leftPanel.appendChild(initialAttackModuleRow.row)

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
    leftPanel.appendChild(healthRow.row)

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
    leftPanel.appendChild(postureRow.row)

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
    leftPanel.appendChild(toughnessRow.row)

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
    leftPanel.appendChild(debugNoDamageRow.row)

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
    leftPanel.appendChild(debugNoDeathRow.row)

    // Color
    const colorRow = EditorUIHelper.createFormRow(
      localizer.t('editor_enemy_prop_color')
    )
    const colorInput = EditorUIHelper.createTextInput({
      value: options.data.color,
    })
    colorRow.row.appendChild(colorInput)

    const colorPicker = EditorUIHelper.createColorInput(options.data.color)
    colorPicker.addEventListener('input', () => {
      colorInput.value = colorPicker.value
    })
    colorInput.addEventListener('input', () => {
      const value = colorInput.value.trim()
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        colorPicker.value = value
      }
    })
    colorRow.row.appendChild(colorPicker)
    leftPanel.appendChild(colorRow.row)

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
      leftPanel.appendChild(row.row)

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
    const colorRegex = /^#[0-9a-fA-F]{6}$/
    const getValidColor = () => {
      const value = colorInput.value.trim()
      return colorRegex.test(value) ? value : options.data.color
    }

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
    const previewPixelsPerMeter = 60
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
      slot.ammo =
        weaponType === 'bow' ? (markerMatches?.bowAmmo ?? defaultBowAmmo) : 0
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
        this.getWeaponRenderType(mainSlotPreview.weaponType),
        mainSlotPreview.weaponWidth,
        mainSlotPreview.weaponHeight,
        mainSlotPreview.sizeLevel,
        mainSlotPreview.sizeMaxLevel,
        mainAmmoValue,
        mainSlotPreview.weaponType === 'bow' ? getAmmoText(mainAmmoValue) : ''
      )
      drawHudWeaponSlot(
        weaponSlotsCtx,
        secondaryX,
        slotY,
        HUD_SLOT_SIZE,
        false,
        secondarySlotPreview.hasWeapon,
        this.getWeaponRenderType(secondarySlotPreview.weaponType),
        secondarySlotPreview.weaponWidth,
        secondarySlotPreview.weaponHeight,
        secondarySlotPreview.sizeLevel,
        secondarySlotPreview.sizeMaxLevel,
        secondaryAmmoValue,
        secondarySlotPreview.weaponType === 'bow'
          ? getAmmoText(secondaryAmmoValue)
          : ''
      )
    }

    const renderCharacterPreview = () => {
      if (!previewCtx) {
        return
      }
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
      const radiusMeters = Number.parseFloat(radiusInput.value)
      const radius =
        Number.isFinite(radiusMeters) && radiusMeters > 0
          ? radiusMeters
          : options.data.radius
      const color = getValidColor()
      const facing = Number.parseInt(facingSelect.value, 10)

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
      renderEnemyPreviewToContext(
        previewCtx,
        centerX,
        centerY,
        radius,
        color,
        previewPixelsPerMeter,
        facing
      )
      if (facing >= 0) {
        renderMainWeapon()
      }
      renderWeaponSlotsPreview()
    }

    const updateCharacterVisualFromInputs = () => {
      const radiusMeters = Number.parseFloat(radiusInput.value)
      const facing = Number.parseInt(facingSelect.value, 10)
      if (Number.isFinite(radiusMeters) && radiusMeters > 0) {
        options.updateMarkerVisual(
          options.marker,
          radiusMeters,
          getValidColor(),
          facing
        )
        this.context.requestRender()
      } else {
        renderCharacterPreview()
      }
    }

    radiusInput.addEventListener('input', () => {
      updateCharacterVisualFromInputs()
      renderCharacterPreview()
    })
    colorPicker.addEventListener('input', () => {
      updateCharacterVisualFromInputs()
      renderCharacterPreview()
    })
    colorInput.addEventListener('input', () => {
      renderCharacterPreview()
      if (colorRegex.test(colorInput.value.trim())) {
        updateCharacterVisualFromInputs()
      }
    })
    facingSelect.addEventListener('change', () => {
      updateCharacterVisualFromInputs()
      renderCharacterPreview()
    })

    renderCharacterPreview()

    confirmBtn.addEventListener('click', () => {
      const radius = Number.parseFloat(radiusInput.value)
      const facing = Number.parseInt(facingSelect.value, 10)
      const maxHealth = Number.parseFloat(healthInput.value)
      const maxPosture = Number.parseFloat(postureInput.value)
      const maxToughness = Number.parseFloat(toughnessInput.value)
      const debugNoDamage = debugNoDamageSelect.value === '1'
      const debugNoDeath = debugNoDeathSelect.value === '1'
      const color = getValidColor()
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
        ? (patrolSelect.value as EnemyPatrolMode)
        : undefined

      if (
        !Number.isFinite(radius) ||
        radius <= 0 ||
        !Number.isFinite(maxHealth) ||
        maxHealth <= 0 ||
        !Number.isFinite(maxPosture) ||
        maxPosture < 0 ||
        !Number.isFinite(maxToughness) ||
        maxToughness < 0 ||
        color.length === 0
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
        moveSpeed: options.showMoveSpeed ? moveSpeed : undefined,
        attackDesire: options.showAttackDesire ? attackDesire : undefined,
        parryProficiency: options.showParry ? parryProficiency : undefined,
        initialPatrolMode: options.showPatrol ? initialPatrolMode : undefined,
        facing,
        initialNormalMovesetId,
        maxHealth,
        maxPosture,
        maxToughness,
        color,
        debugNoDamage,
        debugNoDeath,
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

  public async showEnemyPropertiesDialog(marker: EnemyMarker) {
    const data = this.context.enemyMarkerMap.get(marker)
    if (!data) {
      return
    }
    const editorData = this.context.editorObjectMap.get(marker)
    const enemyTypeLocal = localizer.t(`editor_enemy_${data.enemyType}`)
    const objectName = editorData?.name ?? ''
    const mainBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_main'),
      slot: 'main',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_sword'), value: 'sword' },
        { label: localizer.t('editor_weapon_spear'), value: 'spear' },
        { label: localizer.t('editor_weapon_hammer'), value: 'hammer' },
        { label: localizer.t('editor_weapon_bigHammer'), value: 'bigHammer' },
      ],
      defaultBowAmmo: DEFAULT_BOW_AMMO_ENEMY,
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
        this.context.getOrCreateEnemyWeaponMarker(data, weaponType, 'main'),
    }
    const secondaryBinding: CharacterWeaponBinding = {
      label: localizer.t('editor_weapon_category_secondary'),
      slot: 'secondary',
      options: [
        { label: localizer.t('editor_weapon_none'), value: 'none' },
        { label: localizer.t('editor_weapon_bow'), value: 'bow' },
      ],
      defaultBowAmmo: DEFAULT_BOW_AMMO_ENEMY,
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
        this.context.getOrCreateEnemyWeaponMarker(
          data,
          weaponType,
          'secondary'
        ),
    }

    await this.showCharacterPropertiesDialog({
      title: `[${enemyTypeLocal}] ${objectName}`,
      marker,
      data,
      attackMovesetOwner: 'enemy',
      showMoveSpeed: true,
      showAttackDesire: true,
      showParry: true,
      showPatrol: true,
      weaponBindings: [mainBinding, secondaryBinding],
      updateMarkerVisual: (m, r, c, f) =>
        this.context.updateEnemyMarkerVisual(m as EnemyMarker, r, c, f),
      onCommit: (values) => {
        data.radius = values.radius
        data.moveSpeed = values.moveSpeed ?? data.moveSpeed
        data.attackDesire = values.attackDesire ?? data.attackDesire
        data.parryProficiency = values.parryProficiency ?? data.parryProficiency
        data.initialPatrolMode =
          values.initialPatrolMode ?? data.initialPatrolMode
        data.maxHealth = values.maxHealth
        data.maxPosture = values.maxPosture
        data.maxToughness = values.maxToughness
        data.color = values.color
        data.facing = values.facing
        data.initialNormalMovesetId = values.initialNormalMovesetId
        data.debugNoDamage = values.debugNoDamage
        data.debugNoDeath = values.debugNoDeath

        data.mainWeapon = values.mainWeaponType
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
        data.secondaryWeaponMarker = values.secondaryWeaponMarker
        data.equipWeapon = !!data.mainWeapon || !!data.secondaryWeapon

        marker.radius = data.radius
        marker.moveSpeed = data.moveSpeed
        marker.attackDesire = data.attackDesire
        marker.parryProficiency = data.parryProficiency
        marker.initialPatrolMode = data.initialPatrolMode
        marker.maxHealth = data.maxHealth
        marker.maxPosture = data.maxPosture
        marker.maxToughness = data.maxToughness
        marker.color = data.color
        marker.facing = data.facing
        marker.initialNormalMovesetId = data.initialNormalMovesetId
        marker.debugNoDamage = data.debugNoDamage
        marker.debugNoDeath = data.debugNoDeath
        marker.equipWeapon = data.equipWeapon

        this.context.updateEnemyMarkerVisual(
          marker,
          data.radius,
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
        { label: localizer.t('editor_weapon_bigHammer'), value: 'bigHammer' },
      ],
      defaultBowAmmo: DEFAULT_BOW_AMMO_PLAYER,
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
      ],
      defaultBowAmmo: DEFAULT_BOW_AMMO_PLAYER,
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
      updateMarkerVisual: (m, r, c, f) =>
        this.context.updatePlayerMarkerVisual(m as PlayerMarker, r, c, f),
      onCommit: (values) => {
        data.radius = values.radius
        data.moveSpeed = values.moveSpeed ?? data.moveSpeed
        data.maxHealth = values.maxHealth
        data.maxPosture = values.maxPosture
        data.maxToughness = values.maxToughness
        data.color = values.color
        data.facing = values.facing
        data.initialNormalMovesetId = values.initialNormalMovesetId
        data.debugNoDamage = values.debugNoDamage
        data.debugNoDeath = values.debugNoDeath

        data.mainWeapon = values.mainWeaponType
        data.mainWeaponMarker = values.mainWeaponMarker
        data.secondaryWeapon = values.secondaryWeaponType
        data.secondaryWeaponMarker = values.secondaryWeaponMarker

        marker.radius = data.radius
        marker.maxHealth = data.maxHealth
        marker.maxPosture = data.maxPosture
        marker.maxToughness = data.maxToughness
        marker.color = data.color
        marker.facing = data.facing
        marker.initialNormalMovesetId = data.initialNormalMovesetId
        marker.debugNoDamage = data.debugNoDamage
        marker.debugNoDeath = data.debugNoDeath

        this.context.updatePlayerMarkerVisual(
          marker,
          data.radius,
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
        marker.category ?? (weaponType === 'bow' ? 'secondary' : 'main')
      data = {
        marker,
        weaponType,
        category,
        sizeLevel: marker.sizeLevel ?? template.sizeLevel,
        attackDamage: marker.attackDamage ?? template.attackDamage,
        postureDamage: marker.postureDamage ?? template.postureDamage,
        toughnessDamage: marker.toughnessDamage ?? template.toughnessDamage,
        bowAmmo:
          weaponType === 'bow'
            ? (marker.bowAmmo ?? DEFAULT_BOW_AMMO_PLAYER)
            : undefined,
      }
      this.context.weaponMarkerMap.set(marker, data)
    }
    const baseSnapshot = this.context.getMapSnapshot()
    let committed = false

    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'

    const getSizeName = (level: number): string => {
      if (isBow) {
        return level === 1
          ? localizer.t('editor_weapon_size_bow_1')
          : localizer.t('editor_weapon_size_bow_2')
      } else if (marker.weaponType === 'hammer') {
        return localizer.t('editor_weapon_size_hammer_1')
      } else if (marker.weaponType === 'bigHammer') {
        return localizer.t('editor_weapon_size_bigHammer_1')
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
    if (isBow) {
      const ammoRow = EditorUIHelper.createFormRow(
        localizer.t('editor_weapon_prop_bow_ammo')
      )
      bowAmmoInput = EditorUIHelper.createNumberInput({
        value: data.bowAmmo ?? DEFAULT_BOW_AMMO_PLAYER,
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
