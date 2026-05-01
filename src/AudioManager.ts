import { getPublicAssetUrl } from './publicAssetUrl'
import { SOUND_IDS } from './worker/effectsProtocol'

type SoundDefinition = {
  readonly id: number
  readonly path: string
}

const SOUND_DEFINITIONS: readonly SoundDefinition[] = [
  {
    id: SOUND_IDS.SWORD_SWING_NORMAL,
    path: 'audios/Weapon Sword Whip 01.wav',
  },
  {
    id: SOUND_IDS.SWORD_SWING_FINAL,
    path: 'audios/Weapon Sword Whip 02.wav',
  },
  {
    id: SOUND_IDS.SWORD_PARRY,
    path: 'audios/Weapon Sword Hits Sword 04.wav',
  },
  {
    id: SOUND_IDS.BODY_HIT,
    path: 'audios/Weapon Staff Hit Body Fast 02.wav',
  },
  {
    id: SOUND_IDS.SWORD_HIT_OBSTACLE,
    path: 'audios/Weapon Sword Hit Wood 02.wav',
  },
  {
    id: SOUND_IDS.SWORD_BLOCK,
    path: 'audios/Weapon Broad Sword Hit Metal Deflect 01.wav',
  },
  { id: SOUND_IDS.BOW_SNAP, path: 'audios/Weapon Bow Snap 01.wav' },
  {
    id: SOUND_IDS.DEATH_SPLASH,
    path: 'audios/Liquid Mud Dropped Wet Splash Hard 03.wav',
  },
  {
    id: SOUND_IDS.BODY_HIT_SHARP,
    path: 'audios/Weapon Staff Hit Body Fast 02-sharp.wav',
  },
  {
    id: SOUND_IDS.GRAPPLE_PULL_START,
    path: 'audios/floraphonic-swing-whoosh-in-room-7-234261.wav',
  },
  {
    id: SOUND_IDS.SWORD_ULTIMATE_SPIN,
    path: 'audios/Weapon Sword Pick Up From Ground 01.wav',
  },
  {
    id: SOUND_IDS.SWORD_ULTIMATE_GIANT_RISE,
    path: 'audios/Weapon Sword Whips 02-ultimate.wav',
  },
  { id: SOUND_IDS.HAMMER_ULTIMATE_LAND, path: 'audios/hit-ground.wav' },
  {
    id: SOUND_IDS.SPEAR_ULTIMATE_THRUST,
    path: 'audios/Weapon Whips 02-double.wav',
  },
  { id: SOUND_IDS.PICKUP_ITEM, path: 'audios/pickup_item.ogg' },
  { id: SOUND_IDS.PICKUP_EQUIPMENT, path: 'audios/pickup_item1.ogg' },
  {
    id: SOUND_IDS.HEAVY_SWORD_HIT_GROUND,
    path: 'audios/heavy-sword-hit-ground.wav',
  },
  {
    id: SOUND_IDS.BIG_HAMMER_HIT_ROCK,
    path: 'audios/big-hammer-hit-rock.wav',
  },
  { id: SOUND_IDS.GRAPE_FIRE, path: 'audios/uncork-the-bottle.wav' },
  {
    id: SOUND_IDS.BOMB_EXPLOSION,
    path: 'audios/Explosion Military Bomb 02.wav',
  },
  { id: SOUND_IDS.BOMB_IGNITE, path: 'audios/ignite.ogg' },
  { id: SOUND_IDS.STAGGER_BREAK, path: 'audios/glass_broken.ogg' },
  { id: SOUND_IDS.WOOD_BOX_BROKEN, path: 'audios/wood_box_broken.ogg' },
  {
    id: SOUND_IDS.PASS_THROUGH_GRASS,
    path: 'audios/pass_through_grass.ogg',
  },
]

export class AudioManager {
  private audioContext: AudioContext | null
  private sounds: Map<number, AudioBuffer>
  private masterVolume: number
  private hasUserActivation: boolean
  private muted: boolean
  private initPromise: Promise<void> | null
  private audioUnavailable: boolean
  private loadFailureCount: number
  private firstLoadFailurePath: string
  private firstLoadFailureMessage: string

  constructor() {
    this.audioContext = null
    this.sounds = new Map()
    this.masterVolume = 0.3
    this.hasUserActivation = false
    this.muted = false
    this.initPromise = null
    this.audioUnavailable = false
    this.loadFailureCount = 0
    this.firstLoadFailurePath = ''
    this.firstLoadFailureMessage = ''
  }

  async init(): Promise<void> {
    if (!this.hasUserActivation && !this.hasActiveUserGesture()) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.loadSounds()
    return this.initPromise
  }

  resumeContext(): void {
    const hasActiveGesture = this.hasActiveUserGesture()
    if (!hasActiveGesture && !this.audioContext) {
      return
    }
    this.hasUserActivation = true
    const audioContext = this.getOrCreateAudioContext()
    if (!audioContext) {
      return
    }
    if (
      hasActiveGesture &&
      (audioContext.state === 'suspended' ||
        audioContext.state === 'interrupted')
    ) {
      audioContext.resume().catch((e: unknown) => {
        console.warn('AudioContext resume failed:', e)
      })
    }
    this.init().catch((error: unknown) => {
      console.warn('Audio init failed:', error)
    })
  }

  private hasActiveUserGesture(): boolean {
    return !navigator.userActivation || navigator.userActivation.isActive
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (this.audioContext) {
      return this.audioContext
    }
    if (this.audioUnavailable) {
      return null
    }
    try {
      this.audioContext = new AudioContext()
      return this.audioContext
    } catch (error) {
      this.audioUnavailable = true
      console.warn('AudioContext unavailable:', error)
      return null
    }
  }

  private async loadSounds(): Promise<void> {
    const audioContext = this.getOrCreateAudioContext()
    if (!audioContext) {
      return
    }
    for (let i = 0; i < SOUND_DEFINITIONS.length; i++) {
      const sound = SOUND_DEFINITIONS[i]
      await this.loadSound(audioContext, sound.id, sound.path)
    }
    if (this.loadFailureCount > 0) {
      console.warn(
        `Skipped ${this.loadFailureCount} sound(s). First failure: ${this.firstLoadFailurePath} - ${this.firstLoadFailureMessage}`
      )
    }
  }

  private async loadSound(
    audioContext: AudioContext,
    id: number,
    path: string
  ): Promise<void> {
    try {
      const url = getPublicAssetUrl(path)
      const response = await fetch(url)
      if (!response.ok) {
        this.recordLoadFailure(path, `HTTP ${response.status}`)
        return
      }
      const arrayBuffer = await response.arrayBuffer()
      if (!this.isAudioData(arrayBuffer)) {
        this.recordLoadFailure(path, 'response is not audio data')
        return
      }
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      this.sounds.set(id, audioBuffer)
    } catch (error) {
      this.recordLoadFailure(path, this.getErrorMessage(error))
    }
  }

  private recordLoadFailure(path: string, message: string): void {
    this.loadFailureCount++
    if (this.firstLoadFailurePath.length === 0) {
      this.firstLoadFailurePath = path
      this.firstLoadFailureMessage = message
    }
  }

  private isAudioData(arrayBuffer: ArrayBuffer): boolean {
    if (arrayBuffer.byteLength < 4) {
      return false
    }
    const bytes = new Uint8Array(arrayBuffer, 0, 4)
    return (
      (bytes[0] === 82 &&
        bytes[1] === 73 &&
        bytes[2] === 70 &&
        bytes[3] === 70) ||
      (bytes[0] === 79 &&
        bytes[1] === 103 &&
        bytes[2] === 103 &&
        bytes[3] === 83)
    )
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  play(soundId: number, volume = 1.0, playbackRate = 1.0): void {
    this.playInternal(soundId, volume, playbackRate)
  }

  playSpatial(
    soundId: number,
    volume = 1.0,
    playbackRate = 1.0,
    pan = 0
  ): void {
    this.playInternal(soundId, volume, playbackRate, pan)
  }

  private playInternal(
    soundId: number,
    volume: number,
    playbackRate: number,
    pan?: number
  ): void {
    if (volume <= 0 || this.muted || !this.hasUserActivation) {
      return
    }
    const audioContext = this.audioContext
    if (!audioContext || audioContext.state !== 'running') {
      return
    }
    const buffer = this.sounds.get(soundId)
    if (!buffer) {
      return
    }

    const source = audioContext.createBufferSource()
    const gainNode = audioContext.createGain()
    const stereoPanner =
      pan !== undefined && typeof audioContext.createStereoPanner === 'function'
        ? audioContext.createStereoPanner()
        : null

    source.buffer = buffer
    source.playbackRate.value = playbackRate
    gainNode.gain.value = volume * this.masterVolume
    if (stereoPanner) {
      const clampedPan = pan === undefined ? 0 : Math.max(-1, Math.min(1, pan))
      stereoPanner.pan.value = clampedPan
    }

    source.connect(gainNode)
    if (stereoPanner) {
      gainNode.connect(stereoPanner)
      stereoPanner.connect(audioContext.destination)
    } else {
      gainNode.connect(audioContext.destination)
    }

    source.start()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }
}
