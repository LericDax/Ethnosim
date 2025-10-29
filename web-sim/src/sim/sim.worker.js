self.addEventListener('message', (event) => {
  console.debug('[web-sim] Worker received message:', event.data);
});
