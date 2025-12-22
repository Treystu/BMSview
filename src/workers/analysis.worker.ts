declare const FileReaderSync: any;

self.addEventListener('message', async (ev: MessageEvent) => {
  try {
    const { file, endpoint, fileName, mimeType, messageId } = ev.data || {};
    if (!file) throw new Error('No file provided to worker');
    if (!endpoint) throw new Error('No endpoint provided to worker');
    if (!fileName) throw new Error('No fileName provided to worker');
    // mimeType is optional, we might change it if we resize

    let base64: string = '';
    let finalMimeType = mimeType || file.type;

    // Read file as data URL
    const reader = new FileReaderSync();
    const result = reader.readAsDataURL(file);
    base64 = result.split(',')[1];

    if (!base64) {
      throw new Error('Failed to extract base64 data from file');
    }

    // Match the current sync analyze request contract
    const payload = {
      image: {
        image: base64,
        mimeType: finalMimeType,
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
    // Include messageId for correlation
    self.postMessage({ ok: response.ok, status: response.status, json, messageId });
  } catch (err) {
    self.postMessage({
      ok: false,
      status: 500,
      json: null,
      error: err instanceof Error ? err.message : String(err),
      messageId: ev.data?.messageId // Return ID even on error
    });
  }
});
