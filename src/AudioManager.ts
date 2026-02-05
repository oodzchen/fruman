import { SOUND_IDS } from './worker/effectsProtocol'

export class AudioManager {
  private audioContext: AudioContext
  private sounds: Map<number, AudioBuffer>
  private masterVolume: number

  constructor() {
    this.audioContext = new AudioContext()
    this.sounds = new Map()
    this.masterVolume = 0.3
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
    ])
  }

  resumeContext(): void {
    if (this.audioContext.state === 'suspended') {
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

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
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

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }
}
