// WebAudio: music (streamed, one at a time) + sfx (decoded buffers).
export class AudioEngine {
  ctx: AudioContext | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  /** taps the music before its volume — see `musicPeak` */
  private meter: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private sfxGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  musicVolume = 1;
  sfxVolume = 1;
  /** seconds into the current music track */
  musicTime = 0;
  private musicStartedAt = 0;
  private suspended = false;
  private musicRequest = 0;

  /**
   * Starts at the saved volumes: `FMODAudioEngine` loads `bgVolume` /
   * `sfxVolume` from the save before any scene exists, so a scene that never
   * opens the settings still plays at the player's levels.
   */
  constructor(volumes?: { musicVolume: number; sfxVolume: number }) {
    if (volumes) {
      this.musicVolume = volumes.musicVolume;
      this.sfxVolume = volumes.sfxVolume;
    }
  }

  /** must be called from a user gesture */
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.meter = this.ctx.createAnalyser();
      this.meter.fftSize = 1024;
      this.meterBuf = new Float32Array(this.meter.fftSize);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain.gain.value = this.musicVolume;
      this.sfxGain.gain.value = this.sfxVolume;
    }
    if (!this.suspended && this.ctx.state === "suspended") void this.ctx.resume();
  }

  async load(url: string): Promise<AudioBuffer> {
    this.ensure();
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    const buf = await this.ctx!.decodeAudioData(data);
    this.buffers.set(url, buf);
    return buf;
  }

  async playMusic(url: string, startAt: number | (() => number) = 0) {
    this.ensure();
    this.stopMusic();
    const request = this.musicRequest;
    const buf = await this.load(url);
    // A restart or stop while decoding invalidates this request.
    if (request !== this.musicRequest) return;
    const offset = Math.max(0, typeof startAt === "function" ? startAt() : startAt);
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(this.musicGain!);
    src.connect(this.meter!);
    src.start(0, offset);
    this.musicSource = src;
    this.musicStartedAt = this.ctx!.currentTime - offset;
  }

  /**
   * The music's current peak level, 0..1, as `FMODAudioEngine::updateMetering`
   * reads it (m1 0x35dd20): the output peak divided by the music volume —
   * here taken before the volume is applied, over the last ~21 ms.
   * APPROXIMATION (FIDELITY A51): FMOD meters the whole output (sound effects
   * too) and averages the two channels' peaks; this reads the music alone,
   * down-mixed. 0 while nothing plays or the audio is suspended.
   */
  musicPeak(): number {
    if (!this.meter || !this.meterBuf || !this.musicSource || this.suspended) return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let m = 0;
    for (const v of this.meterBuf) { const a = v < 0 ? -v : v; if (a > m) m = a; }
    return m;
  }

  stopMusic() {
    this.musicRequest++;
    try { this.musicSource?.stop(); } catch { /* not started */ }
    this.musicSource = null;
  }

  /** "running" | "suspended" | "closed" | "none" — tooling/debug only */
  get state(): string {
    return this.ctx?.state ?? "none";
  }

  /**
   * Freeze / unfreeze all audio for the pause menu.
   *
   * Suspending the whole `AudioContext` rather than stopping the music source
   * is what makes this resumable: a `BufferSource` cannot be restarted once
   * stopped, so pausing that way would mean reloading the track and seeking to
   * an offset. Suspending also stops `ctx.currentTime` advancing, so
   * `musicStartedAt` stays correct across the pause and `updateMusicTime()`
   * does not jump. Sound effects freeze with it, which is what you want while
   * a menu is up.
   */
  async setSuspended(suspended: boolean) {
    this.suspended = suspended;
    if (!this.ctx) return;
    try {
      // Queue every transition, including a resume while suspend is pending.
      if (suspended) await this.ctx.suspend();
      else await this.ctx.resume();
    } catch { /* context may be closed or mid-transition */ }
  }

  updateMusicTime() {
    if (this.ctx && this.musicSource) this.musicTime = this.ctx.currentTime - this.musicStartedAt;
  }

  async playSfx(url: string, volume = 1) {
    this.ensure();
    const buf = await this.load(url);
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    const g = this.ctx!.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.sfxGain!);
    src.start();
  }

  setMusicVolume(v: number) {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }
  setSfxVolume(v: number) {
    this.sfxVolume = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }
}
