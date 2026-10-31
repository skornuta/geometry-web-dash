import { ASSET } from "../assetBase.ts";
// WebAudio: music (streamed, one at a time) + sfx (decoded buffers).
/** the menu song and where its place is kept between page loads */
const MENU_TRACK = `${ASSET}menuLoop.mp3`;
const MENU_KEY = "gd-menu-music";
/** a screen change reloads the page in well under this; later than that the song restarts */
const MENU_RESUME_MS = 6000;

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
    const res = await fetch(url);
    // a missing file must not reach the decoder: the dev server answers an unknown
    // path with index.html (200), which would only fail later as a decode error
    if (!res.ok) throw new Error(`audio ${url}: HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    const buf = await this.ctx!.decodeAudioData(data);
    this.buffers.set(url, buf);
    return buf;
  }

  private musicUrl: string | null = null;

  /**
   * The menu song (`menuLoop.mp3`) loops, and carries on across the menu screens.
   * Every screen is its own page load here, so leaving one writes where the song
   * had got to (`leaveMenuMusic`) and the next picks it up at that point plus the
   * wall-clock time since — as if it had never stopped, even when the browser makes
   * it wait for the first click before any sound can start.
   */
  playMenuMusic(url = MENU_TRACK): Promise<void> {
    let at = 0;
    try {
      const s = JSON.parse(sessionStorage.getItem(MENU_KEY) ?? "null") as { url: string; pos: number; at: number } | null;
      const gap = s ? Date.now() - s.at : Infinity;
      if (s && s.url === url && gap >= 0 && gap < MENU_RESUME_MS) at = s.pos + gap / 1000;
    } catch { /* no storage: start from the top */ }
    // the offset is read once the track has decoded, so the decode time counts too
    const t0 = Date.now();
    return this.playMusic(url, () => at + (Date.now() - t0) / 1000, true);
  }

  /**
   * leaving a menu screen: remember the song's place, then stop it. Going into a
   * level (`keep = false`) forgets it instead — coming back to the menus starts the
   * song again from the top, as the game does after a level.
   */
  leaveMenuMusic(keep = true) {
    try {
      if (!keep) sessionStorage.removeItem(MENU_KEY);
      else if (this.ctx && this.musicSource && this.musicUrl) {
        const dur = this.buffers.get(this.musicUrl)?.duration ?? 0;
        let pos = this.ctx.currentTime - this.musicStartedAt;
        if (dur > 0) pos %= dur;
        sessionStorage.setItem(MENU_KEY, JSON.stringify({ url: this.musicUrl, pos, at: Date.now() }));
      }
    } catch { /* storage unavailable */ }
    this.stopMusic();
  }

  /** URLs that already logged a load failure, so a missing file warns once, not per call */
  private failed = new Set<string>();
  private warnOnce(url: string, e: unknown) {
    if (this.failed.has(url)) return;
    this.failed.add(url);
    console.warn(`audio: could not load ${url}`, e);
  }

  async playMusic(url: string, startAt: number | (() => number) = 0, loop = false) {
    this.ensure();
    this.stopMusic();
    const request = this.musicRequest;
    let buf: AudioBuffer;
    try {
      buf = await this.load(url);
    } catch (e) {
      // a failed track leaves silence (the previous one was already stopped); say so once
      this.warnOnce(url, e);
      return;
    }
    // A restart or stop while decoding invalidates this request.
    if (request !== this.musicRequest) return;
    let offset = Math.max(0, typeof startAt === "function" ? startAt() : startAt);
    // a looping track picks up wherever the wall clock says it has got to
    if (loop && buf.duration > 0) offset %= buf.duration;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    this.musicUrl = url;
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
    let buf: AudioBuffer;
    try {
      buf = await this.load(url);
    } catch (e) {
      this.warnOnce(url, e);
      return;
    }
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
