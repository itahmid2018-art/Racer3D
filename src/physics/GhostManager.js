import * as THREE from 'three';

const GHOST_STORAGE_KEY = 'desk_racer_best_lap_ghost_v1';
const SAMPLE_INTERVAL_S = 0.02; // 50 FPS sample rate (20ms interval)

export class GhostManager {
  constructor() {
    this.bestLapData = null; // { lapTime: number, samples: Array }
    this.currentLapSamples = [];
    this.sampleTimer = 0.0;
    this.enabled = true;
    this.loadBestLap();
  }

  loadBestLap() {
    try {
      const stored = localStorage.getItem(GHOST_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed &&
          Array.isArray(parsed.samples) &&
          parsed.samples.length > 0 &&
          typeof parsed.lapTime === 'number'
        ) {
          this.bestLapData = parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load ghost lap from localStorage', e);
    }
  }

  saveBestLap(lapTime, samples) {
    if (!samples || samples.length === 0) return;
    this.bestLapData = {
      lapTime,
      samples: samples.slice(),
    };
    try {
      localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify(this.bestLapData));
    } catch (e) {
      console.warn('Failed to save ghost lap to localStorage', e);
    }
  }

  clearGhost() {
    this.bestLapData = null;
    try {
      localStorage.removeItem(GHOST_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear ghost lap', e);
    }
  }

  hasBestLap() {
    return Boolean(
      this.bestLapData &&
        this.bestLapData.samples &&
        this.bestLapData.samples.length > 0
    );
  }

  getBestLapTime() {
    return this.bestLapData ? this.bestLapData.lapTime : null;
  }

  startNewLap() {
    this.currentLapSamples = [];
    this.sampleTimer = 0.0;
  }

  recordSample(dt, state) {
    if (
      state.autopilot ||
      state.countdownLocked ||
      !state.raceClockActive ||
      state.raceFinished ||
      state.victoryCruise
    ) {
      return;
    }

    this.sampleTimer += dt;
    if (
      this.currentLapSamples.length === 0 ||
      this.sampleTimer >= SAMPLE_INTERVAL_S
    ) {
      this.sampleTimer = 0.0;
      this.currentLapSamples.push({
        t: Number(state.currentLapTime.toFixed(3)),
        s: Number(state.s.toFixed(4)),
        x: Number(state.position.x.toFixed(5)),
        y: Number(state.position.y.toFixed(5)),
        z: Number(state.position.z.toFixed(5)),
        qx: Number(state.quaternion.x.toFixed(5)),
        qy: Number(state.quaternion.y.toFixed(5)),
        qz: Number(state.quaternion.z.toFixed(5)),
        qw: Number(state.quaternion.w.toFixed(5)),
        steerAngle: Number((state.steerAngle || 0).toFixed(4)),
        driftAngle: Number((state.driftAngle || 0).toFixed(4)),
        speed: Number((state.speed || 0).toFixed(4)),
        hopHeight: Number((state.hopHeight || 0).toFixed(4)),
      });
    }
  }

  /**
   * Called when a lap is completed.
   * Returns true if a new personal best ghost was recorded and saved.
   */
  onLapComplete(lapTime) {
    let isNewRecord = false;
    if (this.currentLapSamples.length > 5 && lapTime > 2.0) {
      const currentBest = this.getBestLapTime();
      if (currentBest === null || lapTime < currentBest) {
        this.saveBestLap(lapTime, this.currentLapSamples);
        isNewRecord = true;
      }
    }
    this.startNewLap();
    return isNewRecord;
  }

  getGhostStateAtTime(t) {
    if (!this.hasBestLap()) return null;
    const samples = this.bestLapData.samples;
    if (samples.length === 0) return null;

    if (t <= samples[0].t) {
      return samples[0];
    }
    const last = samples[samples.length - 1];
    if (t >= last.t) {
      return last;
    }

    let low = 0;
    let high = samples.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (samples[mid].t === t) return samples[mid];
      if (samples[mid].t < t) low = mid + 1;
      else high = mid - 1;
    }

    const idxB = Math.min(samples.length - 1, Math.max(1, low));
    const idxA = idxB - 1;
    const sA = samples[idxA];
    const sB = samples[idxB];
    const span = sB.t - sA.t;
    const alpha =
      span > 0.0001 ? Math.min(1.0, Math.max(0.0, (t - sA.t) / span)) : 0.0;

    return {
      t,
      s: THREE.MathUtils.lerp(sA.s, sB.s, alpha),
      x: THREE.MathUtils.lerp(sA.x, sB.x, alpha),
      y: THREE.MathUtils.lerp(sA.y, sB.y, alpha),
      z: THREE.MathUtils.lerp(sA.z, sB.z, alpha),
      qx: sA.qx,
      qy: sA.qy,
      qz: sA.qz,
      qw: sA.qw,
      qxB: sB.qx,
      qyB: sB.qy,
      qzB: sB.qz,
      qwB: sB.qw,
      alpha,
      steerAngle: THREE.MathUtils.lerp(sA.steerAngle, sB.steerAngle, alpha),
      driftAngle: THREE.MathUtils.lerp(sA.driftAngle, sB.driftAngle, alpha),
      speed: THREE.MathUtils.lerp(sA.speed, sB.speed, alpha),
      hopHeight: THREE.MathUtils.lerp(sA.hopHeight, sB.hopHeight, alpha),
    };
  }

  /**
   * Calculates live time delta (in seconds) between user and ghost at current track arc `currentS`.
   * Negative delta means user is ahead (faster!), positive delta means user is behind ghost.
   */
  getLiveDeltaSeconds(currentLapTime, currentS) {
    if (!this.hasBestLap()) return null;
    const samples = this.bestLapData.samples;
    if (!samples || samples.length < 2) return null;

    let closestSample = samples[0];
    let minSDiff = Infinity;

    for (let i = 0; i < samples.length; i++) {
      const diff = Math.abs(samples[i].s - currentS);
      if (diff < minSDiff) {
        minSDiff = diff;
        closestSample = samples[i];
      }
    }

    if (minSDiff > 0.45) {
      return null;
    }

    return currentLapTime - closestSample.t;
  }
}
