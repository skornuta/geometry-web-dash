interface MenuAudio {
  ensure(): void;
  playMenuMusic(): Promise<void>;
  leaveMenuMusic(keep?: boolean): void;
}

/** Menu scenes share the saved switch, but may only unlock audio on real input. */
export class MenuMusic {
  private readonly audio: MenuAudio;
  private readonly enabled: () => boolean;
  private unlocked = false;
  private started = false;

  constructor(audio: MenuAudio, enabled: () => boolean) {
    this.audio = audio;
    this.enabled = enabled;
  }

  gesture(): void {
    this.unlocked = true;
    this.sync();
  }

  /** Apply a changed setting, including cancelling an in-flight track decode. */
  sync(): void {
    if (!this.enabled()) {
      if (this.started) this.audio.leaveMenuMusic(false);
      this.started = false;
      return;
    }
    if (!this.unlocked) return;
    // A previous request can exist in a suspended context (browser autoplay policy).
    // Retry the unlock on each gesture without restarting an already requested loop.
    this.audio.ensure();
    if (this.started) return;
    this.started = true;
    void this.audio.playMenuMusic();
  }
}
