import { schema as s } from 'jazz-tools';

// The source ID is kept verbatim in source_id; Jazz owns a separate UUID id.
export function makeModel(mode) {
  const definitions = { ready: s.table({ marker: s.string() }, {}) };
  if (mode === 'embedded') {
    const common = () => ({ source_id: s.string(), ordinal: s.int(), title: s.string(), body: s.string(), rest: s.json() });
    definitions.issues = s.table(common(), {});
    definitions.notes = s.table(common(), {});
  } else if (mode === 'containers') {
    definitions.nodes = s.table({ path: s.string(), shape: s.string(), scalars: s.json(), children: s.json() }, {});
  } else if (mode === 'collections') {
    definitions.collections = s.table({ name: s.string(), document: s.json() }, {});
  } else throw new Error(`Unknown model ${mode}`);
  const app = s.defineApp(definitions);
  const permissions = s.definePermissions(app, ({ policy }) => {
    for (const name of Object.keys(definitions)) {
      policy[name].allowRead.always();
      policy[name].allowInsert.always();
      policy[name].allowUpdate.always();
      policy[name].allowDelete.always();
    }
  });
  return { app, permissions, tables: Object.keys(definitions).filter(n => n !== 'ready') };
}

export function encodeModel(mode, fixture) {
  if (mode === 'embedded') return Object.fromEntries(Object.entries(fixture).map(([name, records]) => [name,
    records.map(({ id, title, body, ...rest }, ordinal) => ({ source_id: id, ordinal, title, body, rest }))]));
  if (mode === 'collections') return { collections: Object.entries(fixture).map(([name, document]) => ({ name, document })) };
  const nodes = [];
  function visit(value, path) {
    const shape = Array.isArray(value) ? 'array' : 'object';
    const scalars = shape === 'array' ? [] : {};
    const children = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== null && typeof val === 'object') {
        const child = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
        children[key] = child;
        if (shape === 'array') scalars[Number(key)] = null;
        visit(val, child);
      } else scalars[key] = val;
    }
    nodes.push({ path, shape, scalars, children });
  }
  visit(fixture, '');
  return { nodes };
}

export function decodeModel(mode, results) {
  if (mode === 'embedded') return Object.fromEntries(['issues', 'notes'].map(name => [name,
    [...(results[name] ?? [])].sort((a,b) => a.ordinal - b.ordinal).map(({ source_id, title, body, rest }) => ({ ...rest, id: source_id, title, body }))]));
  if (mode === 'collections') return Object.fromEntries((results.collections ?? []).map(r => [r.name, r.document]));
  const nodes = new Map((results.nodes ?? []).map(r => [r.path, r]));
  function visit(path) {
    const node = nodes.get(path);
    if (!node) throw new Error(`Missing container ${path}`);
    const value = structuredClone(node.scalars);
    for (const [key, child] of Object.entries(node.children)) value[key] = visit(child);
    return value;
  }
  return visit('');
}

export function mutationFor(mode, encoded, ids, collection, index, field, value) {
  if (mode === 'embedded') return { table: collection, id: ids[collection][index], patch: { [field]: value } };
  if (mode === 'collections') {
    const i = encoded.collections.findIndex(r => r.name === collection);
    const document = structuredClone(encoded.collections[i].document);
    document[index][field] = value;
    return { table: 'collections', id: ids.collections[i], patch: { document } };
  }
  const i = encoded.nodes.findIndex(r => r.path === `/${collection}/${index}`);
  return { table: 'nodes', id: ids.nodes[i], patch: { scalars: { ...encoded.nodes[i].scalars, [field]: value } } };
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
