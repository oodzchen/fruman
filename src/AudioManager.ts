import { getPublicAssetUrl } from './publicAssetUrl'
import { SOUND_IDS } from './worker/effectsProtocol'

const SOUND_PATHS: readonly (string | null)[] = [
  'audios/Weapon Sword Whip 01.wav',
  null,
  'audios/Weapon Sword Hits Sword 04.wav',
  'audios/Weapon Staff Hit Body Fast 02.wav',
  'audios/Weapon Sword Hit Wood 02.wav',
  'audios/Weapon Broad Sword Hit Metal Deflect 01.wav',
  'audios/Weapon Bow Snap 01.wav',
  'audios/Liquid Mud Dropped Wet Splash Hard 03.wav',
  'audios/Weapon Staff Hit Body Fast 02-sharp.wav',
  'audios/floraphonic-swing-whoosh-in-room-7-234261.wav',
  null,
  'audios/Weapon Sword Whips 02-ultimate.wav',
  'audios/hit-ground.wav',
  'audios/Weapon Whips 02-double.wav',
  'audios/pickup_item.ogg',
  'audios/heavy-sword-hit-ground.wav',
  'audios/big-hammer-hit-rock.wav',
  'audios/uncork-the-bottle.wav',
  'audios/Explosion Military Bomb 02.wav',
  'audios/ignite.ogg',
  'audios/glass_broken.ogg',
  'audios/wood_box_broken.ogg',
  'audios/pass_through_grass.ogg',
  'audios/pickup_item1.ogg',
]

export class AudioManager {
  private audioContext: AudioContext | null
  private sounds: Map<number, AudioBuffer>
  private loadingSounds: Map<number, Promise<AudioBuffer | null>>
  private masterVolume: number
  private hasUserActivation: boolean
  private muted: boolean
  private audioUnavailable: boolean

  constructor() {
    this.audioContext = null
    this.sounds = new Map()
    this.loadingSounds = new Map()
    this.masterVolume = 0.3
    this.hasUserActivation = false
    this.muted = false
    this.audioUnavailable = false
  }

  async init(): Promise<void> {
    if (!this.hasUserActivation && !this.hasActiveUserGesture()) {
      return
    }
    this.getOrCreateAudioContext()
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

  private loadSound(soundId: number): Promise<AudioBuffer | null> {
    const loaded = this.sounds.get(soundId)
    if (loaded) {
      return Promise.resolve(loaded)
    }
    const loading = this.loadingSounds.get(soundId)
    if (loading) {
      return loading
    }
    const path = SOUND_PATHS[soundId]
    const audioContext = this.getOrCreateAudioContext()
    if (!path || !audioContext) {
      return Promise.resolve(null)
    }
    const promise = this.fetchSound(audioContext, soundId, path)
    this.loadingSounds.set(soundId, promise)
    return promise
  }

  private async fetchSound(
    audioContext: AudioContext,
    soundId: number,
    path: string
  ): Promise<AudioBuffer | null> {
    try {
      const url = getPublicAssetUrl(path)
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`Skipped sound ${path}: HTTP ${response.status}`)
        return null
      }
      const arrayBuffer = await response.arrayBuffer()
      if (!this.isAudioData(arrayBuffer)) {
        console.warn(`Skipped sound ${path}: response is not audio data`)
        return null
      }
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      this.sounds.set(soundId, audioBuffer)
      return audioBuffer
    } catch (error) {
      console.warn(`Skipped sound ${path}: ${this.getErrorMessage(error)}`)
      return null
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
      void this.loadSound(soundId).then((loaded) => {
        if (loaded) {
          this.playBuffer(loaded, volume, playbackRate, pan)
        }
      })
      return
    }

    this.playBuffer(buffer, volume, playbackRate, pan)
  }

  private playBuffer(
    buffer: AudioBuffer,
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
