/* Bridge the existing UI to a worker. No Python backend or external service. */
(() => {
  const worker = new Worker(new URL('./search-worker.js', document.currentScript.src));
  let nextId = 0;
  const pending = new Map();
  let failure = null;
  worker.onmessage = ({data}) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    call.cleanup();
    call.resolve({ok: !data.error, json: async () => data.error ? {error:data.error} : data.value});
  };
  worker.onerror = () => {
    failure = 'Browser search could not start. Please reload in a current browser.';
    for (const [id, call] of pending) { call.cleanup(); call.reject(Error(failure)); pending.delete(id); }
  };
  window.asrsFetch = (action, options = {}) => new Promise((resolve, reject) => {
    if (failure) return reject(Error(failure));
    const id = ++nextId;
    const abort = () => { pending.delete(id); reject(new DOMException('Search cancelled', 'AbortError')); };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, {once:true});
    pending.set(id, {resolve, reject, cleanup:() => options.signal?.removeEventListener('abort', abort)});
    worker.postMessage({id, action, payload: options.body ? JSON.parse(options.body) : undefined});
  });
})();
