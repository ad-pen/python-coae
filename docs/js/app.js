// Hash-router single-page app. Five views: modules, module, section, practice menu, practice topic, progress.

const App = (() => {
  const app = document.getElementById('app');
  const topbarTitle = document.getElementById('page-title');
  const backBtn = document.getElementById('back-btn');
  const navLinks = document.querySelectorAll('#bottom-nav a');

  let path = null;
  const moduleCache = {};

  // ---------- data ----------
  async function getPath() {
    if (path) return path;
    const r = await fetch('data/path.json', { cache: 'no-cache' });
    path = await r.json();
    return path;
  }
  async function getModule(slug) {
    if (moduleCache[slug]) return moduleCache[slug];
    const r = await fetch(`data/modules/${slug}.json`, { cache: 'no-cache' });
    moduleCache[slug] = await r.json();
    return moduleCache[slug];
  }
  function allSectionIds(mod) {
    const ids = [];
    for (const ch of mod.chapters || []) for (const s of ch.sections || []) ids.push(s.id);
    return ids;
  }

  // ---------- markdown rendering ----------
  // HTB markdown has \r\n line endings and uses image refs like
  // `https://cdn-edu.hackthebox.com/...` or relative paths. We render as-is.
  function configureMarked() {
    if (!window.marked || marked.__configured) return;
    marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: true,
      mangle: false,
    });
    marked.__configured = true;
  }
  function renderMarkdown(md) {
    configureMarked();
    const html = marked.parse(md || '');
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary'],
      ADD_ATTR: ['target'],
    });
  }

  // After injecting HTML, post-process: highlight code, convert language-python blocks into runnable cells.
  function enhanceLesson(container) {
    container.querySelectorAll('pre > code').forEach((codeEl) => {
      const lang = (codeEl.className.match(/language-(\w+)/) || [])[1] || '';
      const isPy = lang === 'python' || lang === 'py';
      if (isPy) {
        const pre = codeEl.parentElement;
        const src = codeEl.textContent;
        const cell = makeCodeCell({ code: src, lang: 'python', editable: true });
        pre.replaceWith(cell);
      } else {
        if (window.hljs) window.hljs.highlightElement(codeEl);
      }
    });
  }

  // ---------- views ----------
  async function renderModules() {
    setHeader('COAE Practice', false);
    setActiveNav('modules');
    const p = await getPath();
    let html = `
      <p style="color:var(--text-dim);font-size:14px;margin:4px 0 14px">${p.path_name} certification path — ${p.modules.length} modules.</p>
    `;
    for (const m of p.modules) {
      // we only know progress after we read the module file, but reading 12 files at startup is slow.
      // Compute progress on-the-fly using `chapter_count` as a coarse hint.
      const locked = m.locked;
      html += `
        <a class="module-card ${locked ? 'locked' : ''}" href="#/m/${encodeURIComponent(m.slug)}">
          <h3>${escapeHtml(m.title)} ${locked ? '<span class="lock-badge">locked</span>' : ''}</h3>
          <div class="meta">
            <span>${m.chapter_count} chapter${m.chapter_count === 1 ? '' : 's'}</span>
            <span class="progress-pct" data-slug="${m.slug}"></span>
          </div>
          <div class="progress-bar"><div data-slug="${m.slug}" style="width:0%"></div></div>
        </a>
      `;
    }
    app.innerHTML = html;

    // Lazy-load each module file just to compute progress (small, cached anyway)
    for (const m of p.modules) {
      if (m.locked) continue;
      getModule(m.slug).then(mod => {
        const ids = allSectionIds(mod);
        const pct = Math.round(Progress.moduleProgress(m.slug, ids) * 100);
        const pctEl = app.querySelector(`.progress-pct[data-slug="${cssEsc(m.slug)}"]`);
        const barEl = app.querySelector(`.progress-bar > div[data-slug="${cssEsc(m.slug)}"]`);
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (barEl) barEl.style.width = `${pct}%`;
      }).catch(() => {});
    }
  }

  async function renderModule(slug) {
    const mod = await getModule(slug);
    setHeader(mod.title, true);
    setActiveNav('modules');

    if (mod.locked) {
      app.innerHTML = `
        <div class="empty">
          <p>🔒 This module is locked on HTB Academy.</p>
          <p style="font-size:13px">${escapeHtml(mod.note || 'Unlock it and re-run the scraper to pull content.')}</p>
          <p style="font-size:13px"><a href="${escapeHtml(mod.url)}" target="_blank" style="color:var(--accent)">Open on HTB →</a></p>
        </div>`;
      return;
    }

    let html = '';
    for (const ch of mod.chapters) {
      html += `<div class="chapter"><h2>${escapeHtml(ch.group)}</h2>`;
      for (const sec of ch.sections) {
        const done = Progress.isSectionDone(slug, sec.id);
        const locked = sec.locked;
        html += `
          <a class="section-link ${done ? 'done' : ''} ${locked ? 'locked' : ''}"
             href="#/m/${encodeURIComponent(slug)}/${sec.id}">
            <span>${escapeHtml(sec.title)}</span>
            <span class="check">${done ? '✓' : ''}</span>
          </a>`;
      }
      html += `</div>`;
    }
    app.innerHTML = html;
  }

  async function renderSection(slug, secId) {
    const mod = await getModule(slug);
    secId = Number(secId);

    // Flatten section list for prev/next nav
    const flat = [];
    for (const ch of mod.chapters) for (const s of ch.sections) flat.push({ ...s, group: ch.group });
    const idx = flat.findIndex(s => s.id === secId);
    const sec = flat[idx];
    if (!sec) {
      app.innerHTML = `<div class="empty">Section not found.</div>`;
      return;
    }
    setHeader(sec.title, true);
    setActiveNav('modules');
    Progress.markSectionRead(slug, secId);

    const container = document.createElement('div');
    container.className = 'lesson';
    container.innerHTML = renderMarkdown(sec.content || '*(empty)*');
    enhanceLesson(container);

    app.innerHTML = '';
    app.appendChild(container);

    // Questions
    if (sec.questions && sec.questions.length) {
      const qWrap = document.createElement('div');
      qWrap.innerHTML = `<h2 style="font-size:17px;margin-top:24px">Questions</h2>`;
      for (const q of sec.questions) qWrap.appendChild(makeQuestion(q));
      app.appendChild(qWrap);
    }

    // Done / nav
    const nav = document.createElement('div');
    nav.className = 'section-nav';
    const prev = flat[idx - 1];
    const next = flat[idx + 1];
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Previous';
    prevBtn.disabled = !prev;
    prevBtn.addEventListener('click', () => { if (prev) location.hash = `#/m/${slug}/${prev.id}`; });

    const doneBtn = document.createElement('button');
    doneBtn.className = 'primary';
    const isDone = Progress.isSectionDone(slug, secId);
    doneBtn.textContent = isDone ? '✓ Done' : 'Mark as done';
    doneBtn.addEventListener('click', () => {
      const now = !Progress.isSectionDone(slug, secId);
      Progress.markSectionDone(slug, secId, now);
      doneBtn.textContent = now ? '✓ Done' : 'Mark as done';
    });

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = !next;
    nextBtn.addEventListener('click', () => { if (next) location.hash = `#/m/${slug}/${next.id}`; });

    nav.append(prevBtn, doneBtn, nextBtn);
    app.appendChild(nav);

    // scroll back to top on nav
    window.scrollTo(0, 0);
  }

  function makeQuestion(q) {
    const el = document.createElement('div');
    el.className = 'question';
    const got = Progress.isQuestionGot(q.id);
    el.innerHTML = `
      <p class="q-text">${escapeHtml(q.question || '')}</p>
      ${q.file ? `<p class="meta"><a href="${escapeHtml(q.file)}" target="_blank">Download attached file</a></p>` : ''}
      ${q.hint ? `<details><summary style="cursor:pointer;color:var(--text-dim);font-size:13px">Hint</summary><div style="margin-top:6px">${escapeHtml(q.hint)}</div></details>` : ''}
      <textarea placeholder="Your notes / answer…">${escapeHtml(Progress.getAnswer(q.id))}</textarea>
      <div class="q-actions">
        <button type="button" class="got ${got ? 'active' : ''}">${got ? '✓ Got it' : 'Got it'}</button>
        ${q.userAnswer ? `<button type="button" class="reveal">Reveal HTB answer</button>` : ''}
      </div>
      <div class="saved-answer" hidden>${q.userAnswer ? escapeHtml(q.userAnswer) : ''}</div>
      <div class="meta">
        ${q.cubes ? `<span class="tag">${q.cubes} cube${q.cubes === 1 ? '' : 's'}</span>` : ''}
        ${q.experience_points ? `<span class="tag">+${q.experience_points} XP</span>` : ''}
        ${q.protocol ? `<span class="tag">${q.protocol}</span>` : ''}
      </div>
    `;
    const ta = el.querySelector('textarea');
    ta.addEventListener('input', () => Progress.setAnswer(q.id, ta.value));

    const gotBtn = el.querySelector('button.got');
    gotBtn.addEventListener('click', () => {
      const now = !Progress.isQuestionGot(q.id);
      Progress.setQuestionGot(q.id, now);
      gotBtn.classList.toggle('active', now);
      gotBtn.textContent = now ? '✓ Got it' : 'Got it';
    });

    const reveal = el.querySelector('button.reveal');
    if (reveal) {
      const out = el.querySelector('.saved-answer');
      reveal.addEventListener('click', () => {
        out.hidden = !out.hidden;
        reveal.textContent = out.hidden ? 'Reveal HTB answer' : 'Hide HTB answer';
      });
    }
    return el;
  }

  function renderQuiz(topic, questions) {
    const scoreEl = document.createElement('div');
    scoreEl.className = 'quiz-score';
    app.appendChild(scoreEl);

    const updateScore = () => {
      let answered = 0, correct = 0;
      for (const q of questions) {
        const pick = Progress.getQuizPick(topic, q.id);
        if (pick === null) continue;
        answered++;
        if (pick === q.correct) correct++;
      }
      scoreEl.innerHTML = `<strong>${correct} / ${questions.length}</strong> correct · ${answered} / ${questions.length} answered`;
      scoreEl.classList.toggle('done', answered === questions.length);
    };

    questions.forEach((q, qIdx) => {
      const card = document.createElement('div');
      card.className = 'quiz-card';

      const qBody = document.createElement('div');
      qBody.className = 'quiz-q lesson';
      qBody.innerHTML = `<div class="quiz-num">${qIdx + 1} / ${questions.length}</div>` + renderMarkdown(q.question);
      card.appendChild(qBody);

      const opts = document.createElement('div');
      opts.className = 'quiz-options';
      card.appendChild(opts);

      const explainEl = document.createElement('div');
      explainEl.className = 'quiz-explain lesson';
      explainEl.hidden = true;
      card.appendChild(explainEl);

      const paint = () => {
        const pick = Progress.getQuizPick(topic, q.id);
        opts.innerHTML = '';
        q.options.forEach((opt, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'quiz-opt';
          btn.innerHTML = renderMarkdown(opt);
          if (pick !== null) {
            btn.disabled = true;
            if (i === q.correct) btn.classList.add('correct');
            if (i === pick && pick !== q.correct) btn.classList.add('wrong');
            if (i === pick) btn.classList.add('picked');
          }
          btn.addEventListener('click', () => {
            if (Progress.getQuizPick(topic, q.id) !== null) return;
            Progress.setQuizPick(topic, q.id, i);
            paint();
            updateScore();
          });
          opts.appendChild(btn);
        });
        if (pick !== null && q.explain) {
          explainEl.innerHTML = `<strong>${pick === q.correct ? '✓ Correct.' : '✗ Not quite.'}</strong> ${renderMarkdown(q.explain)}`;
          explainEl.hidden = false;
        } else {
          explainEl.hidden = true;
        }
      };
      paint();
      app.appendChild(card);
    });

    const resetWrap = document.createElement('div');
    resetWrap.style.cssText = 'margin:20px 0;text-align:center';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'secondary';
    resetBtn.style.cssText = 'background:transparent;color:var(--text-dim);border:1px solid var(--border);padding:8px 14px;border-radius:6px;cursor:pointer';
    resetBtn.textContent = 'Reset this quiz';
    resetBtn.addEventListener('click', () => {
      if (!confirm('Clear your answers for this quiz?')) return;
      for (const q of questions) Progress.setQuizPick(topic, q.id, null);
      route();
    });
    resetWrap.appendChild(resetBtn);
    app.appendChild(resetWrap);

    updateScore();
  }

  async function renderPracticeMenu() {
    setHeader('Practice', false);
    setActiveNav('practice');
    let html = `<p style="color:var(--text-dim);font-size:14px;margin:4px 0 14px">Hands-on Python exercises. Edit code, hit Run, results show below.</p>`;
    for (const t of Practice.list()) {
      const data = await Practice.loadTopic(t.slug);
      const count = data ? (data.exercises || []).length : 0;
      const status = count ? `${count} exercise${count === 1 ? '' : 's'}` : '<em>coming soon</em>';
      html += `
        <a class="practice-card module-card" href="#/practice/${t.slug}" ${count ? '' : 'style="opacity:.55"'}>
          <div class="pc-title">${escapeHtml(t.title)}</div>
          <div class="pc-desc">${escapeHtml(t.desc)}</div>
          <div class="pc-meta"><span>${status}</span></div>
        </a>`;
    }
    app.innerHTML = html;
  }

  async function renderPracticeTopic(topic) {
    const data = await Practice.loadTopic(topic);
    if (!data) {
      app.innerHTML = `<div class="empty">Topic "${escapeHtml(topic)}" not found.</div>`;
      return;
    }
    setHeader(data.title || topic, true);
    setActiveNav('practice');

    const intro = document.createElement('div');
    intro.className = 'lesson';
    if (data.intro) {
      intro.innerHTML = renderMarkdown(data.intro);
    }
    app.innerHTML = '';
    app.appendChild(intro);

    if (data.quiz && data.quiz.length) {
      renderQuiz(topic, data.quiz);
      window.scrollTo(0, 0);
      return;
    }

    for (const ex of (data.exercises || [])) {
      const card = document.createElement('div');
      card.className = 'exercise-prompt';
      card.innerHTML = `
        <p class="ex-title">${escapeHtml(ex.title || '')}</p>
        ${ex.explain ? `<details class="ex-explain" open><summary>What's used here</summary><div class="lesson">${renderMarkdown(ex.explain)}</div></details>` : ''}
        <div class="ex-prompt lesson">${renderMarkdown(ex.prompt || '')}</div>
      `;
      app.appendChild(card);

      const cell = makeCodeCell({
        code: ex.starter || '',
        lang: 'python',
        editable: true,
        onRun: ({ src }) => {
          const cur = Progress.getExercise(topic, ex.id);
          Progress.setExercise(topic, ex.id, { attempts: (cur.attempts || 0) + 1, lastCode: src });
        },
      });
      app.appendChild(cell);

      if (ex.hint || ex.solution) {
        const det = document.createElement('details');
        det.className = 'exercise-prompt ex-hint';
        det.innerHTML = `
          <summary>Show ${ex.hint ? 'hint' : ''}${ex.hint && ex.solution ? ' / ' : ''}${ex.solution ? 'solution' : ''}</summary>
          ${ex.hint ? `<div style="margin-top:8px"><strong>Hint:</strong> ${escapeHtml(ex.hint)}</div>` : ''}
          ${ex.solution ? `<div style="margin-top:8px"><strong>Solution:</strong></div>` : ''}
        `;
        if (ex.solution) {
          const solCell = makeCodeCell({ code: ex.solution, lang: 'python', editable: false });
          det.appendChild(solCell);
        }
        app.appendChild(det);
      }
    }
    window.scrollTo(0, 0);
  }

  async function renderProgress() {
    setHeader('Progress', false);
    setActiveNav('progress');
    const p = await getPath();
    let totalDone = 0, totalSecs = 0;
    let html = '';

    for (const m of p.modules) {
      if (m.locked) continue;
      const mod = await getModule(m.slug);
      const ids = allSectionIds(mod);
      const done = ids.filter(id => Progress.isSectionDone(m.slug, id)).length;
      totalDone += done; totalSecs += ids.length;
      const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
      html += `
        <div class="progress-section">
          <h3>${escapeHtml(m.title)}</h3>
          <div class="pbar"><div style="width:${pct}%"></div></div>
          <small>${done} / ${ids.length} sections done · ${pct}%</small>
        </div>`;
    }

    const overall = totalSecs ? Math.round(100 * totalDone / totalSecs) : 0;
    const summary = `
      <div class="progress-section" style="background:var(--bg-elev)">
        <h3>Overall</h3>
        <div class="pbar"><div style="width:${overall}%"></div></div>
        <small>${totalDone} / ${totalSecs} sections · ${overall}%</small>
      </div>`;
    app.innerHTML = summary + html + `
      <div style="margin-top:20px;text-align:center">
        <button class="secondary" id="reset-progress" style="background:transparent;color:var(--text-dim);border:1px solid var(--border);padding:8px 14px;border-radius:6px">Reset all progress</button>
      </div>`;
    document.getElementById('reset-progress')?.addEventListener('click', () => {
      if (confirm('Reset all progress and saved answers?')) { Progress.reset(); route(); }
    });
  }

  // ---------- helpers ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function cssEsc(s) { return (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"')); }
  function setHeader(title, showBack) {
    topbarTitle.textContent = title;
    backBtn.hidden = !showBack;
  }
  function setActiveNav(name) {
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.route === name));
  }

  // ---------- router ----------
  function route() {
    const h = location.hash || '#/';
    app.innerHTML = `<div class="loader">Loading…</div>`;
    const parts = h.slice(1).split('/').filter(Boolean);
    // parts examples: [] / ['m','slug'] / ['m','slug','123'] / ['practice'] / ['practice','numpy'] / ['progress']
    try {
      if (parts.length === 0) return renderModules();
      if (parts[0] === 'm' && parts.length === 2) return renderModule(decodeURIComponent(parts[1]));
      if (parts[0] === 'm' && parts.length === 3) return renderSection(decodeURIComponent(parts[1]), parts[2]);
      if (parts[0] === 'practice' && parts.length === 1) return renderPracticeMenu();
      if (parts[0] === 'practice' && parts.length === 2) return renderPracticeTopic(decodeURIComponent(parts[1]));
      if (parts[0] === 'progress') return renderProgress();
      app.innerHTML = `<div class="empty">Unknown route.</div>`;
    } catch (e) {
      app.innerHTML = `<div class="empty">Error: ${escapeHtml(e.message || e)}</div>`;
      console.error(e);
    }
  }

  window.addEventListener('hashchange', route);
  backBtn.addEventListener('click', () => history.back());
  document.addEventListener('DOMContentLoaded', route);
  if (document.readyState !== 'loading') route();

  return { route };
})();
