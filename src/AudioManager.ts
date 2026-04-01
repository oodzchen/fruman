import { SOUND_IDS } from './worker/effectsProtocol'

export class AudioManager {
  private audioContext: AudioContext
  private sounds: Map<number, AudioBuffer>
  private masterVolume: number
  private hasUserActivation: boolean
  private muted: boolean

  constructor() {
    this.audioContext = new AudioContext()
    this.sounds = new Map()
    this.masterVolume = 0.3
    this.hasUserActivation = false
    this.muted = false
  }

  async init(): Promise<void> {
    await Promise.all([
      this.loadSound(
        SOUND_IDS.SWORD_SWING_NORMAL,
        'audios/Weapon Sword Whip 01.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_SWING_FINAL,
        'audios/Weapon Sword Whip 02.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_PARRY,
        'audios/Weapon Sword Hits Sword 04.wav'
      ),
      this.loadSound(
        SOUND_IDS.BODY_HIT,
        'audios/Weapon Staff Hit Body Fast 02.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_HIT_OBSTACLE,
        'audios/Weapon Sword Hit Wood 02.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_BLOCK,
        'audios/Weapon Broad Sword Hit Metal Deflect 01.wav'
      ),
      this.loadSound(SOUND_IDS.BOW_SNAP, 'audios/Weapon Bow Snap 01.wav'),
      this.loadSound(
        SOUND_IDS.DEATH_SPLASH,
        'audios/Liquid Mud Dropped Wet Splash Hard 03.wav'
      ),
      this.loadSound(
        SOUND_IDS.BODY_HIT_SHARP,
        'audios/Weapon Staff Hit Body Fast 02-sharp.wav'
      ),
      this.loadSound(
        SOUND_IDS.GRAPPLE_PULL_START,
        'audios/floraphonic-swing-whoosh-in-room-7-234261.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_ULTIMATE_SPIN,
        'audios/Weapon Sword Pick Up From Ground 01.wav'
      ),
      this.loadSound(
        SOUND_IDS.SWORD_ULTIMATE_GIANT_RISE,
        'audios/Weapon Sword Whips 02-ultimate.wav'
      ),
      this.loadSound(SOUND_IDS.HAMMER_ULTIMATE_LAND, 'audios/hit-ground.wav'),
      this.loadSound(
        SOUND_IDS.SPEAR_ULTIMATE_THRUST,
        'audios/Weapon Whips 02-double.wav'
      ),
      this.loadSound(SOUND_IDS.PICKUP_ITEM, 'audios/pickup-item.wav'),
      this.loadSound(
        SOUND_IDS.HEAVY_SWORD_HIT_GROUND,
        'audios/heavy-sword-hit-ground.wav'
      ),
      this.loadSound(
        SOUND_IDS.BIG_HAMMER_HIT_ROCK,
        'audios/big-hammer-hit-rock.wav'
      ),
      this.loadSound(SOUND_IDS.GRAPE_FIRE, 'audios/uncork-the-bottle.wav'),
    ])
  }

  resumeContext(): void {
    this.hasUserActivation = true
    if (
      this.audioContext.state === 'suspended' ||
      this.audioContext.state === 'interrupted'
    ) {
      this.audioContext.resume().catch((e) => {
        console.warn('AudioContext resume failed:', e)
      })
    }
  }

  private async loadSound(id: number, path: string): Promise<void> {
    try {
      const response = await fetch(path)
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
      this.sounds.set(id, audioBuffer)
    } catch (error) {
      console.error(`Failed to load sound ${path}:`, error)
    }
  }

  play(soundId: number, volume = 1.0, playbackRate = 1.0): void {
    const buffer = this.sounds.get(soundId)
    if (!buffer) {
      console.warn(`Sound ${soundId} not loaded`)
      return
    }

    if (
      this.muted ||
      !this.hasUserActivation ||
      this.audioContext.state !== 'running'
    ) {
      return
    }

    const source = this.audioContext.createBufferSource()
    const gainNode = this.audioContext.createGain()

    source.buffer = buffer
    source.playbackRate.value = playbackRate
    gainNode.gain.value = volume * this.masterVolume

    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)

    source.start()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }
}
