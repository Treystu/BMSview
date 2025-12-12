self.addEventListener('message', async (ev: MessageEvent) => {
  try {
    const { file, endpoint, fileName, mimeType } = ev.data || {};
    if (!file) throw new Error('No file provided to worker');

    // Read file as data URL
    const reader = new FileReaderSync();
    const result = reader.readAsDataURL(file);
    const base64 = result.split(',')[1];

    // Match the current sync analyze request contract
    const payload = { 
      image: {
        image: base64,
        mimeType,
        fileName
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => null);
    
    // Return response envelope compatible with geminiService.ts
    self.postMessage({ ok: response.ok, status: response.status, json });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
});
