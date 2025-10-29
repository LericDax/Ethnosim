// Message bus helpers to standardize communication between main thread and worker.
export function postToWorker(worker, message) {
  worker?.postMessage(message);
}

export function handleWorkerMessage(event) {
  console.debug('Received message from worker:', event.data);
}
