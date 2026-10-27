import {
  table,
  string,
  number,
  boolean,
  json,
  createSchema,
  createBuilder,
  defineQueries,
  defineQuery,
  defineMutators,
} from "@rocicorp/zero";
// Dates stay strings: preserve exact source timestamp spelling and nulls.
export const fields = {
  issues: {
    id: "string",
    number: "number",
    title: "string",
    body: "string",
    state: "string",
    created_at: "string",
    updated_at: "string",
    closed_at: "string?",
    user: "json",
    assignees: "json",
    labels: "json",
    repository: "json",
    comments: "json",
    url: "string",
    milestone: "json?",
  },
  notes: {
    id: "string",
    title: "string",
    body: "string",
    created_at: "string",
    updated_at: "string",
    archived: "boolean",
    pinned: "boolean",
    labels: "json",
    checklist: "json",
    attachments: "json",
    reminder: "json?",
    collaborators: "json",
  },
};
export function model(variant) {
  const defs =
    variant === "typed"
      ? fields
      : variant === "record"
        ? { issues: { id: "string", data: "json" }, notes: { id: "string", data: "json" } }
        : { collections: { id: "string", data: "json" } };
  const tables = Object.entries(defs).map(([name, cols]) =>
    table(name)
      .columns(
        Object.fromEntries(
          Object.entries(cols).map(([k, t]) => {
            let b = { string, number, boolean, json }[t.replace("?", "")]();
            if (t.endsWith("?")) b = b.optional();
            return [k, b];
          }),
        ),
      )
      .primaryKey("id"),
  );
  const schema = createSchema({ tables, enableLegacyQueries: false, enableLegacyMutators: false });
  const zql = createBuilder(schema);
  const queries = defineQueries(
    Object.fromEntries(
      Object.keys(defs).map((name) => [name, defineQuery(() => zql[name].orderBy("id", "asc"))]),
    ),
  );
  // No client mutations in this receive-only benchmark; sender changes use normal PG transactions.
  const mutators = defineMutators({});
  return { schema, zql, queries, mutators, defs };
}
export function rows(variant, data) {
  if (variant === "typed") return data;
  if (variant === "record")
    return Object.fromEntries(
      Object.entries(data).map(([k, arr]) => [k, arr.map((r) => ({ id: r.id, data: r }))]),
    );
  return { collections: Object.entries(data).map(([id, data]) => ({ id, data })) };
}
export function reconstruct(variant, result) {
  if (variant === "typed") return result;
  if (variant === "record")
    return Object.fromEntries(
      Object.entries(result).map(([k, arr]) => [k, arr.map((r) => r.data)]),
    );
  return Object.fromEntries(result.collections.map((r) => [r.id, r.data]));
}
export const canonical = (x) => JSON.stringify(sort(x));
function sort(x) {
  return Array.isArray(x)
    ? x.map(sort)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sort(x[k])]),
        )
      : x;
}
