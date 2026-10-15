import { blendClipPose, newClipPose, type ClipPose, type ClipSource } from './animationClips';

const CROSSFADE = 0.9;
/** Minimum run time of one clip before moving on (short clips loop). */
const MIN_RUN = 14;
/** Maximum run before switching clips (long Mixamo routines). */
const MAX_RUN = 45;

const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/**
 * Sequences imported dance clips: picks clips in a shuffled order, lets each one
 * run for a while and cross-fades (at the pose level, so clips with different
 * skeletons blend fine) into the next.
 */
export class DanceController {
  private clips: ClipSource[] = [];
  private order: ClipSource[] = [];
  private cur: ClipSource | null = null;
  private prev: ClipSource | null = null;
  private curT = 0;
  private prevT = 0;
  private fade = 1;
  private runFor = 0;
  private a = newClipPose();
  private b = newClipPose();
  readonly pose = newClipPose();

  get hasClips() { return this.clips.length > 0; }
  get currentName() { return this.cur?.name ?? null; }

  setClips(clips: ClipSource[]) {
    if (clips === this.clips) return;
    this.clips = clips;
    this.order = this.order.filter((c) => clips.includes(c));
    if (this.cur && !clips.includes(this.cur)) this.cur = null;
    if (this.prev && !clips.includes(this.prev)) { this.prev = null; this.fade = 1; }
  }

  /** Forget playback state so the next dance starts on a fresh clip. */
  stop() {
    this.cur = null;
    this.prev = null;
    this.fade = 1;
  }

  /** Jump straight to another clip (user request). */
  skip() {
    if (this.cur) this.startNext(true);
  }

  /** Advance playback; returns the blended pose or null when no clips are loaded. */
  update(dt: number): ClipPose | null {
    if (!this.clips.length) return null;
    if (!this.cur) this.startNext(false);
    this.curT += dt;
    this.prevT += dt;
    this.fade = Math.min(1, this.fade + dt / CROSSFADE);
    if (this.curT >= this.runFor && this.clips.length > 1) this.startNext(true);

    this.cur!.sample(this.curT, this.a);
    if (this.prev && this.fade < 1) {
      this.prev.sample(this.prevT, this.b);
      blendClipPose(this.b, this.a, smooth(this.fade), this.pose);
    } else {
      blendClipPose(this.a, this.a, 0, this.pose);
    }
    return this.pose;
  }

  private startNext(crossfade: boolean) {
    if (!this.order.length) {
      this.order = [...this.clips].sort(() => Math.random() - 0.5);
      // Avoid immediately repeating the clip that just finished.
      if (this.order.length > 1 && this.order[0] === this.cur) this.order.push(this.order.shift()!);
    }
    const next = this.order.shift()!;
    this.prev = crossfade ? this.cur : null;
    this.prevT = this.curT;
    this.cur = next;
    this.curT = 0;
    this.fade = crossfade ? 0 : 1;
    const d = next.duration;
    this.runFor = d >= MIN_RUN ? Math.min(d, MAX_RUN) : d * Math.ceil(MIN_RUN / d);
  }
}
