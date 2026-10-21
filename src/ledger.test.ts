import { describe, it, expect } from "vitest";
import initSqlJs from "sql.js";
import {
  readCsv,
  initialRules,
  inspect,
  validType,
  exportCsv,
  manifest,
  csv,
  metadataColumn,
} from "./ledger";
const load = () => initSqlJs();
describe("CSV structure and exact values", () => {
  it("reads quoted delimiters, multiline text and Unicode", () => {
    const s = readCsv('id,note\r\nA,"Café, Hull\nsecond line"\r\n');
    expect(s.rows).toEqual([["A", "Café, Hull\nsecond line"]]);
  });
  it("detects semicolons and handles a BOM", () =>
    expect(readCsv("\uFEFFid;amount\nA;12,50").delimiter).toBe(";"));
  it("rejects malformed quoting and inconsistent widths", () => {
    expect(() => readCsv('id,note\nA,"broken')).toThrow();
    expect(() => readCsv("id,note\nA,one,extra")).toThrow(/Record 1/);
  });
  it("rejects empty headers and duplicate headers", () => {
    expect(() => readCsv("id,\nA,B")).toThrow();
    expect(() => readCsv("id,id\nA,B")).toThrow();
  });
  it("keeps an interior blank record when the structure allows it", () =>
    expect(readCsv("id\nA\n\nB").rows).toEqual([["A"], [""], ["B"]]));
});
describe("type ambiguity", () => {
  it("requires ISO dates with a real calendar date", () => {
    expect(validType("2026-02-29", "date")).toBe(false);
    expect(validType("2024-02-29", "date")).toBe(true);
    expect(validType("03/04/2026", "date")).toBe(false);
  });
  it("rejects decimal commas, padding and precision coercion", () => {
    expect(validType("12,50", "decimal")).toBe(false);
    expect(validType(" 12.50", "decimal")).toBe(false);
    expect(validType("12.50", "decimal")).toBe(true);
    expect(validType("001", "integer")).toBe(false);
  });
});
describe("SQLite validation and exports", () => {
  it("rejects all duplicates and uses a JOIN for reference membership", async () => {
    const s = readCsv(
      "id,status,joined\nA,active,2026-10-01\nA,unknown,03/04/2026\nC,active,2026-10-02",
    );
    const r = initialRules(s);
    r[1].reference = ["active", "paused"];
    r[2].type = "date";
    const a = await inspect(s, r, load);
    expect(a.valid).toEqual([3]);
    expect(a.rejected).toEqual([1, 2]);
    expect(a.issues.map((i) => i.kind)).toEqual([
      "Duplicate",
      "Duplicate",
      "Type",
      "Reference",
    ]);
    expect(
      a.queries.some(
        (q) => q.sql.includes("GROUP BY") && q.sql.includes("HAVING"),
      ),
    ).toBe(true);
    expect(a.queries.some((q) => q.sql.includes("LEFT JOIN"))).toBe(true);
  });
  it("keeps mapping values separate from SQL identifiers", async () => {
    const s = readCsv("id,value\nA,ok");
    const r = initialRules(s);
    r[1].name = "x; DROP TABLE records";
    r[1].reference = ["x' OR 1=1 --"];
    const a = await inspect(s, r, load);
    expect(a.rejected).toEqual([1]);
  });
  it("finds required blanks without silently trimming outputs", async () => {
    const s = readCsv("id,name\n , Ada \nB,Bex");
    const a = await inspect(s, initialRules(s), load);
    expect(a.rejected).toEqual([1]);
    expect(a.mapped[0][1]).toBe(" Ada ");
  });
  it("exports deterministically and protects spreadsheet formula cells", async () => {
    const s = readCsv("id,note\nA,=1+2");
    const r = initialRules(s),
      a = await inspect(s, r, load);
    const out = exportCsv(a, r, "valid");
    expect(out).toContain("'=1+2");
    expect(exportCsv(a, r, "valid")).toBe(out);
    expect(manifest(s, r, a, "abc")).toBe(manifest(s, r, a, "abc"));
  });
  it("revalidates repaired rows", async () => {
    const s = readCsv("id,date\nA,01/02/2026");
    const r = initialRules(s);
    r[1].type = "date";
    expect((await inspect(s, r, load)).rejected).toEqual([1]);
    s.rows[0][1] = "2026-02-01";
    expect((await inspect(s, r, load)).valid).toEqual([1]);
  });
});

describe("audit boundaries", () => {
  it("treats whitespace-only required values consistently with optional values", async () => {
    const sheet = readCsv('id,note\n"\t",ok\nB,"\n"');
    const result = await inspect(sheet, initialRules(sheet), load);
    expect(result.rejected).toEqual([1]);
    expect(result.issues[0].kind).toBe("Required");
  });
  it("uses distinct metadata names and escapes header formula prefixes", () => {
    expect(
      metadataColumn(["_source_record", "__source_record"], "_source_record"),
    ).toBe("___source_record");
    expect(csv([" =1+2"], [["\t=2+3"]])).toContain(`"' =1+2"`);
    expect(csv(["note"], [["  =2+3"]])).toContain("'  =2+3");
  });
  it("records exact explicit edits separately from the original fingerprint", async () => {
    const original = readCsv("id,date\nA,03/04/2026");
    const current = { ...original, rows: [["A", "2026-04-03"]] };
    const rules = initialRules(current);
    rules[1].type = "date";
    const audit = await inspect(current, rules, load);
    const report = JSON.parse(
      manifest(current, rules, audit, "original-hash", original.rows),
    );
    expect(report.source.sha256).toBe("original-hash");
    expect(report.edits).toEqual([
      { record: 1, field: "date", before: "03/04/2026", after: "2026-04-03" },
    ]);
    expect(report.summary.valid).toBe(1);
  });
});
