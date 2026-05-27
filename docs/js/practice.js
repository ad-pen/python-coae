// Practice topic list — loaded from data/practice/<topic>.json
const Practice = (() => {
  const TOPICS = [
    { slug: 'basics',     title: 'Level 1 — Python Basics',        desc: 'Variables, loops, comprehensions, lambdas, files.' },
    { slug: 'numpy',      title: 'Level 2 — NumPy for ML',          desc: 'Arrays, shape, indexing, masks, random — building blocks.' },
    { slug: 'pandas',     title: 'Level 3 — pandas',                desc: 'DataFrames, filtering, groupby. Used for datasets & feature work.' },
    { slug: 'sklearn',    title: 'Level 4 — scikit-learn',          desc: 'Train/test split, fit/predict, metrics, pipelines.' },
    { slug: 'checkpoint1',title: 'Checkpoint A — Quiz: Levels 1–4', desc: 'Multiple-choice. Tests basics, numpy, pandas, sklearn.' },
    { slug: 'pytorch',    title: 'Level 5 — PyTorch',               desc: 'Tensors, models, training loop, autograd.' },
    { slug: 'attacks',    title: 'Level 6 — Attack scripts',        desc: 'Label flipping, evasion, prompt injection in code.' },
  ];

  const cache = {};

  async function loadTopic(slug) {
    if (cache[slug]) return cache[slug];
    try {
      const r = await fetch(`data/practice/${slug}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      cache[slug] = j;
      return j;
    } catch (e) {
      return null;
    }
  }

  function list() { return TOPICS.slice(); }

  return { list, loadTopic };
})();
