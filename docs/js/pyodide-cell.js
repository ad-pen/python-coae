// Lazy Pyodide loader + code-cell runner.
// Pyodide is fetched only on first Run click — initial page is tiny.

const PyRuntime = (() => {
  const PYODIDE_VERSION = '0.26.2';
  const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

  let loadingPromise = null;
  let py = null;
  let availablePackages = new Set();

  // Stable packages to install on first load. NumPy is small enough to bundle eagerly.
  // pandas/sklearn/etc. load on demand via `await pyodide.loadPackagesFromImports(code)`.
  const EAGER_PACKAGES = ['numpy'];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensure() {
    if (py) return py;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        await loadScript(PYODIDE_BASE + 'pyodide.js');
        py = await window.loadPyodide({ indexURL: PYODIDE_BASE });
        if (EAGER_PACKAGES.length) await py.loadPackage(EAGER_PACKAGES);
        for (const p of EAGER_PACKAGES) availablePackages.add(p);
        return py;
      } catch (e) {
        loadingPromise = null;
        throw e;
      }
    })();
    return loadingPromise;
  }

  // Run code, capturing stdout/stderr. Returns { ok, stdout, stderr, result }.
  async function run(code) {
    const pyodide = await ensure();
    // Try to autoload packages mentioned in imports
    try { await pyodide.loadPackagesFromImports(code); } catch (_) {}

    const wrapper = `
import sys, io, traceback
__buf_out = io.StringIO()
__buf_err = io.StringIO()
__old_out, __old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = __buf_out, __buf_err
__ok = True
__result = None
try:
    __result = exec(compile(${JSON.stringify(code)}, "<cell>", "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
except BaseException:
    __ok = False
    traceback.print_exc()
finally:
    sys.stdout, sys.stderr = __old_out, __old_err
__buf_out.getvalue(), __buf_err.getvalue(), __ok
`;
    // exec_with_capture: we use runPythonAsync which returns the value of the last expression.
    let stdout = '', stderr = '', ok = true;
    try {
      const tuple = await pyodide.runPythonAsync(wrapper);
      [stdout, stderr, ok] = tuple.toJs();
      tuple.destroy?.();
    } catch (e) {
      ok = false;
      stderr = String(e.message || e);
    }
    return { ok, stdout, stderr };
  }

  function isLoaded() { return !!py; }
  function isLoading() { return !!loadingPromise && !py; }

  return { ensure, run, isLoaded, isLoading };
})();

// Build a runnable code cell DOM element.
// opts: { code, lang, editable, onRun }
function makeCodeCell(opts) {
  const { code, lang = 'python', editable = true, label } = opts;

  const wrap = document.createElement('div');
  wrap.className = 'code-cell';

  const header = document.createElement('div');
  header.className = 'cell-header';
  header.innerHTML = `<span class="lang">${lang}</span><span class="hint">${label || ''}</span>`;
  wrap.appendChild(header);

  let editor;
  if (editable) {
    editor = document.createElement('textarea');
    editor.spellcheck = false;
    editor.autocomplete = 'off';
    editor.autocapitalize = 'off';
    editor.value = code;
    // auto-grow to content
    requestAnimationFrame(() => {
      editor.style.height = 'auto';
      editor.style.height = Math.min(400, editor.scrollHeight + 4) + 'px';
    });
    editor.addEventListener('input', () => {
      editor.style.height = 'auto';
      editor.style.height = Math.min(400, editor.scrollHeight + 4) + 'px';
    });
    // Tab inserts spaces
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = editor.selectionStart, ee = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(ee);
        editor.selectionStart = editor.selectionEnd = s + 4;
      }
    });
    wrap.appendChild(editor);
  } else {
    const pre = document.createElement('pre');
    const c = document.createElement('code');
    c.className = `language-${lang}`;
    c.textContent = code;
    pre.appendChild(c);
    wrap.appendChild(pre);
    if (window.hljs) window.hljs.highlightElement(c);
  }

  if (lang !== 'python') return wrap;  // non-python: no run button

  const actions = document.createElement('div');
  actions.className = 'actions';

  const runBtn = document.createElement('button');
  runBtn.className = 'run';
  runBtn.type = 'button';
  runBtn.innerHTML = '<span>&#9654;</span> Run';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'secondary';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.hidden = !editable;

  const status = document.createElement('span');
  status.className = 'status';

  actions.appendChild(runBtn);
  if (editable) actions.appendChild(resetBtn);
  actions.appendChild(status);
  wrap.appendChild(actions);

  const output = document.createElement('div');
  output.className = 'output';
  wrap.appendChild(output);

  runBtn.addEventListener('click', async () => {
    const src = editable ? editor.value : code;
    runBtn.disabled = true;
    output.classList.remove('error');
    output.textContent = '';
    if (!PyRuntime.isLoaded()) {
      status.textContent = 'Loading Python… (one-time, ~10MB)';
    } else {
      status.textContent = 'Running…';
    }
    try {
      const r = await PyRuntime.run(src);
      let out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
      output.textContent = out || '(no output)';
      if (!r.ok || r.stderr) output.classList.add('error');
      status.textContent = '';
    } catch (e) {
      output.textContent = String(e.message || e);
      output.classList.add('error');
      status.textContent = '';
    } finally {
      runBtn.disabled = false;
      opts.onRun?.({ src });
    }
  });

  resetBtn.addEventListener('click', () => {
    if (editor) {
      editor.value = code;
      editor.style.height = 'auto';
      editor.style.height = Math.min(400, editor.scrollHeight + 4) + 'px';
    }
    output.textContent = '';
    output.classList.remove('error');
  });

  return wrap;
}
