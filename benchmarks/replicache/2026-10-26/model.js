// All mappings preserve nulls, nested fields, identifiers, and array order.
export const models = ['records', 'shared', 'collections'];
export const canonical = value => JSON.stringify(sort(value));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
}
export function encodeModel(data, model) {
  if (model === 'collections') return new Map([['collection/issues', data.issues], ['collection/notes', data.notes]]);
  if (!models.includes(model)) throw Error('Unknown model: ' + model);
  const map = new Map();
  function shared(kind, obj) {
    const key = `${kind}/${obj.id}`;
    if (map.has(key) && canonical(map.get(key)) !== canonical(obj)) throw Error('Conflicting shared entity: ' + key);
    map.set(key, structuredClone(obj));
    return key;
  }
  for (const [collection, prefix] of [['issues', 'issue'], ['notes', 'note']]) {
    for (const record of data[collection]) {
      const out = structuredClone(record);
      if (model === 'shared' && collection === 'issues') {
        out.user = shared('user', record.user);
        out.assignees = record.assignees.map(v => shared('user', v));
        out.labels = record.labels.map(v => shared('label', v));
        out.repository = shared('repository', record.repository);
        out.comments = record.comments.map(v => ({...v, author: shared('user', v.author)}));
        out.milestone = record.milestone === null ? null : shared('milestone', record.milestone);
      }
      map.set(`${prefix}/${record.id}`, out);
    }
  }
  return map;
}
export function decodeModel(entries, model) {
  const map = new Map(entries);
  if (model === 'collections') return {issues: map.get('collection/issues') ?? [], notes: map.get('collection/notes') ?? []};
  const result = {issues: [], notes: []};
  const deref = key => {
    if (!map.has(key)) throw Error('Missing shared key: ' + key);
    return structuredClone(map.get(key));
  };
  for (const [key, value] of [...map.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    const out = structuredClone(value);
    if (key.startsWith('issue/')) {
      if (model === 'shared') {
        out.user = deref(out.user);
        out.assignees = out.assignees.map(deref);
        out.labels = out.labels.map(deref);
        out.repository = deref(out.repository);
        out.comments = out.comments.map(v => ({...v, author: deref(v.author)}));
        out.milestone = out.milestone === null ? null : deref(out.milestone);
      }
      result.issues.push(out);
    } else if (key.startsWith('note/')) result.notes.push(out);
  }
  return result;
}
export function changed(data, version) {
  const out = structuredClone(data);
  if (version >= 2) out.issues[0].title += ' [synthetic title update]';
  if (version >= 3) out.notes[0].body += ' [synthetic note body update]';
  return out;
}
export function patchBetween(before, after) {
  if (!before) return [{op: 'clear'}, ...[...after].map(([key,value]) => ({op:'put', key, value}))];
  return [...[...before.keys()].filter(k => !after.has(k)).map(key => ({op:'del',key})),
    ...[...after].filter(([k,v]) => canonical(before.get(k) ?? null) !== canonical(v)).map(([key,value]) => ({op:'put', key, value}))];
}
