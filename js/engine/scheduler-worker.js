/* Web Worker：在背景執行緒執行純邏輯自動排課與多方案探索 */
if (typeof executeAutoScheduleCore !== 'function' && typeof importScripts === 'function') {
  const _workerQuery = (typeof self !== 'undefined' && self.location && self.location.search) ? self.location.search : '';
  importScripts('../core/state.js' + _workerQuery, '../core/indexes.js' + _workerQuery, 'scheduler-core.js' + _workerQuery);
}

function hydrateWorkerState(snapshot) {
  state.classes = snapshot.classes || [];
  state.teachers = snapshot.teachers || [];
  state.subjects = snapshot.subjects || [];
  state.assignments = snapshot.assignments || [];
  state.schedule = (snapshot.schedule || []).map(entry => ({ ...entry }));
  state.scheduleRevision = String(snapshot.scheduleRevision || '');
  state.teacherBlocks = snapshot.teacherBlocks || [];
  state.subjectRules = snapshot.subjectRules || [];
  state.subjectRelations = snapshot.subjectRelations || [];
  state.blockGroups = snapshot.blockGroups || [];
  state.rooms = snapshot.rooms || [];
  state.scheduleColors = snapshot.scheduleColors || [];
  state.teacherExclusives = snapshot.teacherExclusives || [];
  state.settings = snapshot.settings || {};
  buildIndex();
}

self.onmessage = async function (event) {
  const msg = event && event.data ? event.data : {};
  const id = msg.id;
  const postProgress = text => self.postMessage({ type: 'progress', id, message: String(text || '') });
  const workerYield = () => Promise.resolve();
  try {
    hydrateWorkerState(msg.stateSnapshot || {});
    if (msg.type === 'runMulti') {
      const specs = Array.isArray(msg.runSpecs) ? msg.runSpecs : [];
      const budgetMs = Number(msg.timeBudgetMs) || 240000;
      const startedAt = Date.now();
      const candidates = [];
      for (let index = 0; index < specs.length; index++) {
        if (index > 0 && Date.now() - startedAt >= budgetMs) break;
        postProgress('多方案探索：第 ' + (index + 1) + '/' + specs.length + ' 個候選…');
        const candidate = await executeAutoScheduleCore({
          previewOnly: true,
          skipUiCommit: true,
          skipPreflight: true,
          config: msg.config || {},
          seed: specs[index].seed,
          randomize: specs[index].randomize,
          onProgress: postProgress,
          yieldFn: workerYield
        });
        if (candidate) candidates.push({ ...candidate, seed: specs[index].seed });
      }
      self.postMessage({ type: 'done', id, candidates });
      return;
    }
    const result = await executeAutoScheduleCore({
      ...(msg.runOptions || {}),
      skipUiCommit: true,
      skipPreflight: true,
      config: msg.config || {},
      onProgress: postProgress,
      yieldFn: workerYield
    });
    self.postMessage({ type: 'done', id, result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: String(error && error.message ? error.message : (error || 'Worker error'))
    });
  }
};
