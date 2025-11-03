self.addEventListener('message', async (ev: MessageEvent) => {
  try {
    const { file, endpoint } = ev.data || {};
    if (!file) throw new Error('No file provided to worker');

    // Read file as data URL
    const reader = new FileReaderSync();
    const result = reader.readAsDataURL(file);
    const base64 = result.split(',')[1];

    const payload = { image: { image: base64 }, sync: true };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      self.postMessage({ error: `Server responded with ${response.status}: ${text}` });
      return;
    }

    const json = await response.json();
    self.postMessage({ result: json });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
});
