import { localizer } from '../../Localizer'
import type { BoneSegment } from '../../editorMapTypes'
import { renderSkeletalBodyToCanvas } from '../../renderer/SkeletalCanvasRenderer'
import {
  type SkeletalPoseInput,
  acquireGaitState,
  releaseGaitState,
  updateSkeletalPoseFromInput,
} from '../../renderer/SkeletalPoseDriver'
import { getOrBuildSkeleton } from '../../renderer/SkeletalSpineBuilder'
import type { SkeletalAnimationName } from '../../skeletalAnimation'
import { EditorUIHelper } from '../EditorUIHelper'

const PREVIEW_RADIUS_PX = 64
const PREVIEW_PPM = 128
const PREVIEW_CANVAS_SIZE = 320
const PREVIEW_SCALE_NUMERATOR = 7
const PREVIEW_SCALE_DENOMINATOR = 10
const PREVIEW_ENTITY_Y = 24

export function showBodyDrawerAnimationPreview(options: {
  viewport: HTMLElement
  animationName: SkeletalAnimationName
  segments: BoneSegment[]
}): void {
  const { modal, close } = EditorUIHelper.createModal({ zIndex: 10004 })
  const form = EditorUIHelper.createFormContainer({ minWidth: '420px' })
  form.style.minWidth = '420px'
  form.style.padding = '18px'
  form.style.gap = '12px'

  const title = EditorUIHelper.createFormTitle(
    `${localizer.t('editor_body_drawer_animation_preview_title')} · ${localizer.t(
      `editor_body_drawer_animation_${options.animationName}`
    )}`
  )
  title.style.marginBottom = '4px'
  form.appendChild(title)

  const hint = document.createElement('div')
  hint.textContent = localizer.t('editor_body_drawer_animation_preview_hint')
  hint.style.cssText =
    'font-size:11px;line-height:1.5;color:rgba(255,255,255,0.62);'
  form.appendChild(hint)

  const canvas = EditorUIHelper.createPreviewCanvas({
    width: PREVIEW_CANVAS_SIZE,
    height: PREVIEW_CANVAS_SIZE,
  })
  canvas.style.width = `${PREVIEW_CANVAS_SIZE}px`
  canvas.style.height = `${PREVIEW_CANVAS_SIZE}px`
  canvas.style.background =
    'radial-gradient(circle at 50% 28%, rgba(120,140,106,0.16), rgba(12,12,12,0.92) 70%)'
  canvas.style.border = '1px solid rgba(255,255,255,0.12)'
  form.appendChild(canvas)

  const footer = EditorUIHelper.createButtonRow({
    gap: '8px',
    marginTop: '0',
  })
  const closeBtn = EditorUIHelper.createButton(localizer.t('editor_btn_cancel'))
  footer.appendChild(closeBtn)
  form.appendChild(footer)
  modal.appendChild(form)
  options.viewport.appendChild(modal)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    close()
    return
  }

  const built = getOrBuildSkeleton(
    options.segments,
    PREVIEW_RADIUS_PX,
    PREVIEW_PPM
  )
  const gait = acquireGaitState()
  const poseInput: SkeletalPoseInput = {
    entityX: 0,
    entityY: PREVIEW_ENTITY_Y,
    animationName: options.animationName,
    combatReady: false,
    weaponActive: false,
    weaponX: 0,
    weaponY: PREVIEW_ENTITY_Y,
    moveDir:
      options.animationName === 'move' || options.animationName === 'run'
        ? 1
        : 0,
    facing: 1,
    ppm: PREVIEW_PPM,
    deltaMsInt: 16,
  }
  let rafId = 0
  let closed = false
  let lastTs = 0

  const cleanup = () => {
    if (closed) {
      return
    }
    closed = true
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    releaseGaitState(gait)
    close()
  }

  const drawFrame = (ts: number) => {
    if (closed) {
      return
    }
    const deltaMs =
      lastTs > 0 ? Math.max(0, Math.min(50, Math.round(ts - lastTs))) : 16
    lastTs = ts
    poseInput.deltaMsInt = deltaMs
    updateSkeletalPoseFromInput(
      built.skeleton,
      built.boneIndex,
      gait,
      poseInput
    )

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, Math.round(canvas.height * 0.78), canvas.width, 2)
    renderSkeletalBodyToCanvas(
      ctx,
      built,
      options.segments,
      Math.round(canvas.width / 2),
      Math.round(canvas.height * 0.64),
      PREVIEW_SCALE_NUMERATOR / PREVIEW_SCALE_DENOMINATOR,
      1
    )
    rafId = requestAnimationFrame(drawFrame)
  }

  closeBtn.addEventListener('click', cleanup)
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      cleanup()
    }
  })
  rafId = requestAnimationFrame(drawFrame)
}
