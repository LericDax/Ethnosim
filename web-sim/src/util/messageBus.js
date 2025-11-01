const MESSAGE_TYPES = Object.freeze({
  INIT: 'INIT',
  SNAPSHOT: 'SNAPSHOT',
  CONTROL: 'CONTROL',
});

/**
 * Normalizes a seed value to a 32-bit integer that can be safely
 * transferred across the worker boundary. When a seed is omitted the
 * function returns `undefined` to avoid overriding upstream defaults.
 *
 * @param {unknown} seed
 * @returns {number|undefined}
 */
function normalizeSeed(seed) {
  if (seed === null || seed === undefined) return undefined;
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed | 0;
  }
  if (typeof seed === 'string') {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return hash;
  }
  return undefined;
}

/**
 * Wraps `addEventListener` so the caller can easily detach a listener when it
 * is no longer needed.
 *
 * @template {Worker|DedicatedWorkerGlobalScope} Target
 * @param {Target} target
 * @param {(this: Target, event: MessageEvent) => void} handler
 * @returns {() => void}
 */
function attach(target, handler) {
  target.addEventListener('message', handler);
  return () => target.removeEventListener('message', handler);
}

/**
 * Registers a callback that fires when an INIT message is received.
 *
 * @template {Worker|DedicatedWorkerGlobalScope} Target
 * @param {Target} port
 * @param {(payload: Record<string, unknown>, meta: { message: any, event: MessageEvent }) => void} callback
 * @returns {() => void}
 */
export function onInit(port, callback) {
  return attach(port, (event) => {
    const message = event.data;
    if (!message || message.type !== MESSAGE_TYPES.INIT) return;
    callback(message, { message, event });
  });
}

/**
 * Registers a callback that fires whenever a SNAPSHOT message is received.
 * The callback receives the normalized snapshot payload along with the raw
 * message metadata.
 *
 * @template {Worker|DedicatedWorkerGlobalScope} Target
 * @param {Target} port
 * @param {(snapshot: import('./snapshotTypes.js').Snapshot, meta: { message: any, event: MessageEvent }) => void} callback
 * @returns {() => void}
 */
export function onSnapshot(port, callback) {
  return attach(port, (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === MESSAGE_TYPES.SNAPSHOT) {
      callback(message.snapshot ?? message, { message, event });
      return;
    }
    if (message.snapshot && !message.type) {
      callback(message.snapshot, { message, event });
    }
  });
}

/**
 * Registers a callback for CONTROL messages such as pause/resume.
 *
 * @template {Worker|DedicatedWorkerGlobalScope} Target
 * @param {Target} port
 * @param {(command: string, payload: Record<string, unknown>, meta: { message: any, event: MessageEvent }) => void} callback
 * @returns {() => void}
 */
export function onControl(port, callback) {
  return attach(port, (event) => {
    const message = event.data;
    if (!message || message.type !== MESSAGE_TYPES.CONTROL) return;
    const { command = '', ...rest } = message;
    callback(command, rest, { message, event });
  });
}

/**
 * Sends an INIT message to the worker with the normalized payload.
 *
 * @param {Worker} worker
 * @param {Record<string, unknown>} payload
 */
export function sendInit(worker, payload = {}) {
  const message = { type: MESSAGE_TYPES.INIT, ...payload };
  const randomnessMode =
    typeof message.randomnessMode === 'string'
      ? message.randomnessMode
      : undefined;

  if (randomnessMode === 'chaotic') {
    if (message.seed === undefined || message.seed === null || message.seed === '') {
      delete message.seed;
    } else {
      const normalized = normalizeSeed(message.seed);
      if (normalized !== undefined) {
        message.seed = normalized;
      }
    }
  } else if ('seed' in message) {
    const normalized = normalizeSeed(message.seed);
    if (normalized !== undefined) {
      message.seed = normalized;
    }
  }

  worker.postMessage(message);
}

/**
 * Sends a control message (pause, resume, step, etc.) to the worker.
 *
 * @param {Worker} worker
 * @param {string} command
 * @param {Record<string, unknown>} [payload]
 */
export function sendControl(worker, command, payload = {}) {
  worker.postMessage({
    type: MESSAGE_TYPES.CONTROL,
    command,
    ...payload,
  });
}

/**
 * Posts a snapshot payload from the worker back to the main thread.
 *
 * @template {Worker|DedicatedWorkerGlobalScope} Target
 * @param {Target} port
 * @param {import('./snapshotTypes.js').Snapshot} snapshot
 * @param {Record<string, unknown>} [meta]
 */
export function postSnapshot(port, snapshot, meta = {}) {
  port.postMessage({
    type: MESSAGE_TYPES.SNAPSHOT,
    snapshot,
    ...meta,
  });
}

export { MESSAGE_TYPES };
