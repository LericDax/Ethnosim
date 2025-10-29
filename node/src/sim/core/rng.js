/**
 * Deterministic pseudo-random number generator based on XorShift32.
 * All randomness in the worker should flow through this helper so
 * that a seed + tick reproduce the same sim history.
 */
export class RNG {
  /**
   * @param {number} seedValue
   */
  constructor(seedValue = 1) {
    /** @private */
    this._state = 0;
    this.seed(seedValue);
  }

  /**
   * Sets the RNG seed. Seed of 0 is remapped to a non-zero constant so that
   * the generator cannot get stuck.
   * @param {number} value
   */
  seed(value) {
    let v = Number(value) >>> 0;
    if (!v) {
      v = 0x9e3779b9; // golden ratio fraction – keeps state non-zero
    }
    this._state = v >>> 0;
  }

  /**
   * Produces the next uint32 in the sequence.
   * @returns {number}
   */
  nextUint() {
    let x = this._state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._state = x >>> 0;
    return this._state;
  }

  /**
   * Returns a float in the range [0, 1).
   * @returns {number}
   */
  nextFloat() {
    return (this.nextUint() >>> 0) / 0x100000000;
  }

  /**
   * Returns an integer within [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   */
  nextInt(min, max) {
    if (max < min) {
      [min, max] = [max, min];
    }
    const span = max - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  /**
   * Returns a float within [min, max).
   * @param {number} min
   * @param {number} max
   */
  nextRange(min, max) {
    return min + this.nextFloat() * (max - min);
  }
}

/**
 * Helper to create a RNG instance.
 * @param {number} seed
 */
export function createRng(seed = 1) {
  return new RNG(seed);
}
