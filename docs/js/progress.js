// Tiny localStorage-backed progress / answer store.
// Stored under key `coae:progress`. Shape:
// {
//   sectionsDone: { "<modSlug>/<secId>": true },
//   sectionsRead: { "<modSlug>/<secId>": 1700000000 },
//   answers:      { "<questionId>": "user text" },
//   exercises:    { "<topic>/<exId>": { done: true, attempts: 3 } },
//   questionsGot: { "<questionId>": true },
// }
const Progress = (() => {
  const KEY = 'coae:progress';
  let state = null;

  function load() {
    if (state) return state;
    try {
      state = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (_) {
      state = {};
    }
    state.sectionsDone ||= {};
    state.sectionsRead ||= {};
    state.answers      ||= {};
    state.exercises    ||= {};
    state.questionsGot ||= {};
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  return {
    isSectionDone(modSlug, secId) {
      load();
      return !!state.sectionsDone[`${modSlug}/${secId}`];
    },
    markSectionDone(modSlug, secId, done = true) {
      load();
      const k = `${modSlug}/${secId}`;
      if (done) state.sectionsDone[k] = true;
      else delete state.sectionsDone[k];
      save();
    },
    markSectionRead(modSlug, secId) {
      load();
      state.sectionsRead[`${modSlug}/${secId}`] = Date.now();
      save();
    },
    sectionRead(modSlug, secId) {
      load();
      return !!state.sectionsRead[`${modSlug}/${secId}`];
    },
    getAnswer(qid) { load(); return state.answers[qid] || ''; },
    setAnswer(qid, text) { load(); state.answers[qid] = text; save(); },

    isQuestionGot(qid) { load(); return !!state.questionsGot[qid]; },
    setQuestionGot(qid, got) {
      load();
      if (got) state.questionsGot[qid] = true;
      else delete state.questionsGot[qid];
      save();
    },

    getExercise(topic, exId) {
      load();
      return state.exercises[`${topic}/${exId}`] || { done: false, attempts: 0, lastCode: null };
    },
    setExercise(topic, exId, patch) {
      load();
      const k = `${topic}/${exId}`;
      state.exercises[k] = { ...(state.exercises[k] || {}), ...patch };
      save();
    },

    moduleProgress(modSlug, allSectionIds) {
      load();
      if (!allSectionIds.length) return 0;
      let done = 0;
      for (const id of allSectionIds) if (state.sectionsDone[`${modSlug}/${id}`]) done++;
      return done / allSectionIds.length;
    },

    raw() { return load(); },
    reset() {
      state = null;
      localStorage.removeItem(KEY);
    },
  };
})();
