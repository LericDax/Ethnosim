// Web Worker entry point for the Star Nexus simulation loop.
self.addEventListener('message', (event) => {
  console.debug('Worker received message:', event.data);
  // TODO: forward to simulation systems once implemented.
});
