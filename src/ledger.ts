import Papa from "papaparse";
import initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";

export type FieldType = "text" | "integer" | "decimal" | "date" | "email";
export interface Rule {
  id: string;
  name: string;
  source: number | null;
  required: boolean;
  type: FieldType;
  key: boolean;
  reference: string[];
}
export interface Sheet {
  headers: string[];
  rows: string[][];
  delimiter: string;
  name: string;
}
export interface Issue {
  record: number;
  field: string;
  kind: string;
  message: string;
  relatedRecords?: number[];
  matchingRecordCount?: number;
}
export interface Query {
  name: string;
  sql: string;
  parameters: string[];
  issueCount: number;
}
export interface Audit {
  issues: Issue[];
  valid: number[];
  rejected: number[];
  queries: Query[];
  mapped: string[][];
}
export const LIMIT_BYTES = 1_000_000;
export const LIMIT_RECORDS = 5000;
export const LIMIT_COLUMNS = 60;

export function readCsv(
  text: string,
  name = "records.csv",
  delimiter = "",
): Sheet {
  if (new TextEncoder().encode(text).length > LIMIT_BYTES)
    throw new Error("Choose a UTF-8 CSV no larger than 1 MB.");
  if (!text.trim())
    throw new Error(
      "The file is empty. Include a header and at least one record.",
    );
  if (text.includes("\0"))
    throw new Error("The file contains a null character. Choose a text CSV.");
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter,
    skipEmptyLines: false,
  });
  const errors = parsed.errors.filter(
    (e) => e.code !== "UndetectableDelimiter",
  );
  if (errors.length)
    throw new Error(`CSV could not be read: ${errors[0].message}`);
  const data = parsed.data;
  // Empty physical lines at the end do not describe data records.
  while (
    data.length > 1 &&
    data.at(-1)?.length === 1 &&
    data.at(-1)?.[0] === "" &&
    /[\r\n]$/.test(text)
  )
    data.pop();
  if (data.length < 2)
    throw new Error("Include a header and at least one data record.");
  const headers = data[0];
  if (headers.length > LIMIT_COLUMNS)
    throw new Error(`Choose at most ${LIMIT_COLUMNS} columns.`);
  if (headers.some((h) => !h.trim()))
    throw new Error("Every source column needs a non-empty header.");
  if (new Set(headers).size !== headers.length)
    throw new Error(
      "Duplicate source headers need distinct names before mapping.",
    );
  const rows = data.slice(1);
  if (rows.length > LIMIT_RECORDS)
    throw new Error(
      `Choose at most ${LIMIT_RECORDS.toLocaleString("en-GB")} records.`,
    );
  const uneven = rows.findIndex((row) => row.length !== headers.length);
  if (uneven >= 0)
    throw new Error(
      `Record ${uneven + 1} has ${rows[uneven].length} columns; the header has ${headers.length}. Repair the CSV structure first.`,
    );
  return { headers, rows, delimiter: parsed.meta.delimiter, name };
}

export function initialRules(sheet: Sheet): Rule[] {
  return sheet.headers.map((name, index) => ({
    id: `f${index}`,
    name,
    source: index,
    required: index === 0,
    type: "text",
    key: index === 0,
    reference: [],
  }));
}
export const typeExpectations: Record<FieldType, string> = {
  text: "text",
  integer: "a whole number, such as 12 or -3, without leading zeros",
  decimal:
    "a decimal with a full stop, such as 12.50 or -3.25, without thousands separators",
  date: "a real calendar date in YYYY-MM-DD form",
  email: "a basic email address in name@example.test form, without spaces",
};
export function validType(value: string, type: FieldType): boolean {
  if (!value.trim()) return true; // Required is a separate rule. Preserve exact values.
  switch (type) {
    case "text":
      return true;
    case "integer":
      return /^-?(?:0|[1-9]\d*)$/.test(value);
    case "decimal":
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    }
  }
}
export function validateRules(rules: Rule[], sheet: Sheet) {
  if (!rules.length || rules.length > LIMIT_COLUMNS)
    throw new Error(`Map between 1 and ${LIMIT_COLUMNS} target fields.`);
  if (rules.some((r) => !r.name.trim()))
    throw new Error("Every target field needs a name.");
  if (new Set(rules.map((r) => r.name.trim())).size !== rules.length)
    throw new Error("Target field names must be distinct.");
  if (
    rules.some(
      (r) =>
        r.source !== null &&
        (!Number.isInteger(r.source) ||
          r.source < 0 ||
          r.source >= sheet.headers.length),
    )
  )
    throw new Error("A source column is missing. Check the mapping.");
  if (rules.some((r) => r.required && r.source === null))
    throw new Error("Map every required field to a source column.");
  if (rules.some((r) => r.reference.length > 500))
    throw new Error("Use at most 500 reference values per field.");
}

export async function inspect(
  sheet: Sheet,
  rules: Rule[],
  load: () => Promise<SqlJsStatic>,
): Promise<Audit> {
  validateRules(rules, sheet);
  const SQL = await load(),
    db = new SQL.Database();
  const issues: Issue[] = [],
    queries: Query[] = [];
  const mapped = sheet.rows.map((row) =>
    rules.map((r) => (r.source === null ? "" : row[r.source])),
  );
  try {
    db.create_function("is_blank", (value: unknown) =>
      String(value ?? "").trim().length === 0 ? 1 : 0,
    );
    const columns = rules.map((_, i) => `f${i} TEXT`).join(",");
    db.run(
      `CREATE TABLE records(record INTEGER PRIMARY KEY,${columns}); CREATE TABLE reference_values(field TEXT,value TEXT);`,
    );
    const insert = db.prepare(
      `INSERT INTO records VALUES (${Array(rules.length + 1)
        .fill("?")
        .join(",")})`,
    );
    mapped.forEach((row, i) => insert.run([i + 1, ...row]));
    insert.free();
    for (const type of ["integer", "decimal", "date", "email"] as const)
      db.create_function(`valid_${type}`, (value: unknown) =>
        validType(String(value ?? ""), type) ? 1 : 0,
      );
    const ref = db.prepare("INSERT INTO reference_values VALUES (?,?)");
    rules.forEach((r, f) =>
      [...new Set(r.reference)].forEach((v) => ref.run([`f${f}`, v])),
    );
    ref.free();
    db.run("CREATE INDEX reference_lookup ON reference_values(field,value)");
    const duplicateGroups = new Map<string, number[]>();
    function check(
      name: string,
      sql: string,
      parameters: string[],
      field: string,
      kind: string,
      message: string | ((row: Record<string, unknown>) => string),
    ) {
      const statement = db.prepare(sql);
      statement.bind(parameters);
      let count = 0;
      while (statement.step()) {
        const row = statement.getAsObject();
        let relatedRecords: number[] | undefined;
        let matchingRecordCount: number | undefined;
        if (kind === "Duplicate") {
          const group = String(row.records);
          let partners = duplicateGroups.get(group);
          if (!partners) {
            partners = group.split(",").map(Number);
            duplicateGroups.set(group, partners);
          }
          matchingRecordCount = partners.length - 1;
          relatedRecords = partners
            .slice(0, 11)
            .filter((n) => n !== Number(row.record))
            .slice(0, 10);
          row.partnerPreview = relatedRecords.join(", ");
          row.remainingPartners = matchingRecordCount - relatedRecords.length;
        }
        issues.push({
          record: Number(row.record),
          field,
          kind,
          message: typeof message === "function" ? message(row) : message,
          ...(relatedRecords ? { relatedRecords, matchingRecordCount } : {}),
        });
        count++;
      }
      statement.free();
      queries.push({ name, sql, parameters, issueCount: count });
    }
    rules.forEach((r, i) => {
      const col = `f${i}`;
      if (r.required)
        check(
          `${r.name}: required`,
          `SELECT record FROM records WHERE is_blank(${col}) = 1 ORDER BY record`,
          [],
          r.name,
          "Required",
          "A required value is blank.",
        );
      if (r.type !== "text")
        check(
          `${r.name}: ${r.type}`,
          `SELECT record FROM records WHERE is_blank(${col}) = 0 AND valid_${r.type}(${col}) = 0 ORDER BY record`,
          [],
          r.name,
          "Type",
          `Expected ${typeExpectations[r.type]}. The value has not been converted.`,
        );
      if (r.key)
        check(
          `${r.name}: duplicate key`,
          `SELECT r.record, repeated.value, repeated.records FROM records AS r JOIN (SELECT ${col} AS value, GROUP_CONCAT(record) AS records FROM records WHERE is_blank(${col}) = 0 GROUP BY ${col} HAVING COUNT(*) > 1) AS repeated ON r.${col} = repeated.value ORDER BY r.record`,
          [],
          r.name,
          "Duplicate",
          (row) =>
            `Value “${row.value}” is also used by record(s) ${row.partnerPreview}${Number(row.remainingPartners) > 0 ? ` and ${row.remainingPartners} more` : ""}. Every matching record has its own finding.`,
        );
      if (r.reference.length)
        check(
          `${r.name}: reference list`,
          `SELECT r.record FROM records AS r LEFT JOIN reference_values AS allowed ON allowed.field = ? AND allowed.value = r.${col} WHERE is_blank(r.${col}) = 0 AND allowed.value IS NULL ORDER BY r.record`,
          [col],
          r.name,
          "Reference",
          "The value is not in the allowed list. Match one of the configured values exactly.",
        );
    });
    issues.sort(
      (a, b) =>
        a.record - b.record ||
        a.field.localeCompare(b.field, "en") ||
        a.kind.localeCompare(b.kind, "en"),
    );
    const bad = new Set(issues.map((i) => i.record)),
      valid: number[] = [],
      rejected: number[] = [];
    mapped.forEach((_, i) => (bad.has(i + 1) ? rejected : valid).push(i + 1));
    return { issues, valid, rejected, queries, mapped };
  } finally {
    db.close();
  }
}

export function needsSpreadsheetProtection(value: string): boolean {
  return /^[\t\r\n]|^\s*[=+@-]/.test(value);
}
function spreadsheetSafe(value: string): string {
  return needsSpreadsheetProtection(value) ? "'" + value : value;
}
export function metadataColumn(headers: string[], preferred: string): string {
  let name = preferred;
  while (headers.includes(name)) name = "_" + name;
  return name;
}
export function csv(
  headers: string[],
  rows: string[][],
  protect = true,
): string {
  return (
    Papa.unparse(
      {
        fields: protect ? headers.map(spreadsheetSafe) : headers,
        data: protect ? rows.map((row) => row.map(spreadsheetSafe)) : rows,
      },
      { newline: "\r\n", quotes: true, escapeFormulae: protect },
    ) + "\r\n"
  );
}
export function exportCsv(
  audit: Audit,
  rules: Rule[],
  kind: "valid" | "rejected",
  protect = false,
): string {
  const ids = audit[kind];
  return csv(
    [
      metadataColumn(
        rules.map((r) => r.name),
        "_source_record",
      ),
      ...rules.map((r) => r.name),
    ],
    ids.map((n) => [String(n), ...audit.mapped[n - 1]]),
    protect,
  );
}
export function manifest(
  sheet: Sheet,
  rules: Rule[],
  audit: Audit,
  hash: string,
  originalRows: string[][] = sheet.rows,
) {
  return (
    JSON.stringify(
      {
        format: "import-ledger/audit-v1",
        source: {
          name: sheet.name,
          sha256: hash,
          delimiter: sheet.delimiter,
          records: sheet.rows.length,
          columns: sheet.headers,
        },
        mapping: rules.map((r) => ({
          name: r.name,
          source: r.source,
          required: r.required,
          type: r.type,
          key: r.key,
          reference: r.reference,
          sourceHeader: r.source === null ? null : sheet.headers[r.source],
        })),
        summary: {
          valid: audit.valid.length,
          rejected: audit.rejected.length,
          issues: audit.issues.length,
        },
        edits: sheet.rows.flatMap((row, i) =>
          row.flatMap((value, f) =>
            value === originalRows[i]?.[f]
              ? []
              : [
                  {
                    record: i + 1,
                    field: sheet.headers[f],
                    before: originalRows[i]?.[f] ?? "",
                    after: value,
                  },
                ],
          ),
        ),
        exportSchema: {
          validRecordColumn: metadataColumn(
            rules.map((r) => r.name),
            "_source_record",
          ),
          rejectedRecordColumn: metadataColumn(sheet.headers, "_source_record"),
          rejectedIssuesColumn: metadataColumn(
            [...sheet.headers, metadataColumn(sheet.headers, "_source_record")],
            "_issues",
          ),
        },
        issues: audit.issues,
        queries: audit.queries,
        exportNotes:
          "Valid import values are preserved by default. Optional spreadsheet protection prefixes matching cells with an apostrophe and changes their values; the review CSV always applies it. Explicit edits are recorded below; unchanged source values are not copied into this audit. Record numbers count data records, not physical lines. No live destination has been checked.",
      },
      null,
      2,
    ) + "\n"
  );
}
export { initSqlJs };
