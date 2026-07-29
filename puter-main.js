/**
 * Reading Copilot — Puter bridge.
 *
 * Injected into the page's MAIN world via chrome.scripting.executeScript
 * (never via a <script src> tag, so the page's CSP cannot block this file).
 * It lazily loads the Puter SDK on the first request and relays streaming
 * chat responses to the extension's content script over window.postMessage.
 *
 * Security note: everything crossing this bridge is treated as untrusted by
 * the content script — responses are rendered through a sanitizing Markdown
 * renderer, never as raw HTML.
 */
(() => {
  'use strict';

  const RES = 'rc-puter-res';
  const REQ = 'rc-puter-req';
  const announce = () => window.postMessage({ source: RES, type: 'ready' }, '*');

  if (window.__rcPuterBridge) {
    announce();
    return;
  }
  window.__rcPuterBridge = true;

  let sdkPromise = null;
  const loadSdk = () => {
    if (window.puter) return Promise.resolve();
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.puter.com/v2/';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          sdkPromise = null;
          reject(
            new Error(
              "Failed to load the Puter SDK (this site's security policy may block it). " +
                'Switch to a custom OpenAI-compatible API in Reading Copilot settings.'
            )
          );
        };
        (document.head || document.documentElement).appendChild(script);
      });
    }
    return sdkPromise;
  };

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== REQ || !data.id) return;

    const send = (payload) =>
      window.postMessage(Object.assign({ source: RES, id: data.id }, payload), '*');

    try {
      await loadSdk();
      const stream = await window.puter.ai.chat(data.messages, {
        model: data.model,
        stream: true,
      });
      for await (const part of stream) {
        const text =
          (part && (part.text || (part.message && part.message.content))) || '';
        if (text) send({ type: 'chunk', text: String(text) });
      }
      send({ type: 'done' });
    } catch (error) {
      const message =
        (error && (error.message || (error.error && error.error.message))) ||
        'Puter request failed.';
      send({ type: 'error', message: String(message) });
    }
  });

  announce();
})();
