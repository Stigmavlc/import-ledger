import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("sample checks expose the SQL and real findings", async ({ page }) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("3 valid · 3 requiring review · 4 findings", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "customer_id: duplicate key 2 findings",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "GROUP BY f0 HAVING COUNT(*) > 1",
  );
  await page.getByRole("button", { name: "Close query", exact: true }).click();
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit record 2, name", exact: true }),
  ).toHaveCount(0);
});
test("a valid UTF-8 upload preserves values and offers explicit spreadsheet protection", async ({
  page,
}, info) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('id,note\r\nA,"Café, Hull"\r\nB, =1+2\r\n'),
  });
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("2 valid · 0 requiring review · 0 findings", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Valid records/ }).click();
  const download = await d;
  const target = path.join(info.outputDir, "valid.csv");
  await download.saveAs(target);
  const text = await readFile(target, "utf8");
  expect(text).toContain("Café, Hull");
  expect(text).toContain('" =1+2"');
  expect(text).not.toContain("' =1+2");
  await page
    .getByRole("checkbox", {
      name: "Add spreadsheet protection to the valid CSV",
    })
    .check();
  const protectedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Valid records/ }).click();
  const protectedTarget = path.join(info.outputDir, "protected.csv");
  await (await protectedDownload).saveAs(protectedTarget);
  expect(await readFile(protectedTarget, "utf8")).toContain("' =1+2");
  expect(download.suggestedFilename()).toBe("import-ledger-valid.csv");
});
test("corrections invalidate results and every check runs again", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 3, customer_id", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New customer_id", exact: true })
    .fill("C-1099");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "03Export files", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("5 valid · 1 requiring review · 2 findings", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit record 4, joined", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New joined", exact: true })
    .fill("2026-04-03");
  await page
    .getByRole("textbox", { name: "New status", exact: true })
    .fill("active");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("6 valid · 0 requiring review · 0 findings", {
      exact: true,
    }),
  ).toBeVisible();
});
test("rejected export retains unmapped source columns with distinct metadata names", async ({
  page,
}, info) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "records.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "_source_record,id,note\nmeta,A,private sample\nother,A,second sample",
    ),
  });
  await page.getByRole("button", { name: "Remove note", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Unique key _source_record", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Unique key id", exact: true })
    .check();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Records requiring review/ }).click();
  const dl = await d;
  const target = path.join(info.outputDir, "rejected.csv");
  await dl.saveAs(target);
  const content = await readFile(target, "utf8");
  expect(content).toContain("private sample");
  expect(content).toContain(
    '"__source_record","_source_record","id","note","_issues"',
  );
});
test("malformed and invalid UTF-8 files fail visibly", async ({ page }) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "broken.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('id,note\nA,"open'),
  });
  await expect(page.getByRole("alert")).toContainText("CSV could not be read");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "binary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0xff, 0xff]),
  });
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
});
test("no remote requests or persistence are used for an imported file", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173/") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("3 valid · 3 requiring review · 4 findings", {
      exact: true,
    }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Try the sample", exact: true }),
  ).toBeVisible();
});
test("mobile mapping and editing remain contained and keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 4, joined", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("audit download keeps source identity and explicit changes", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 4, joined", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New joined", exact: true })
    .fill("2026-04-03");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /Audit manifest/ }).click();
  const downloaded = await waiting;
  const target = path.join(info.outputDir, "audit.json");
  await downloaded.saveAs(target);
  const report = JSON.parse(await readFile(target, "utf8"));
  expect(report.format).toBe("import-ledger/audit-v1");
  expect(report.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.summary).toEqual({ valid: 3, rejected: 3, issues: 3 });
  expect(report.edits).toEqual([
    { record: 4, field: "joined", before: "03/04/2026", after: "2026-04-03" },
  ]);
  expect(
    report.queries.some((query: { sql: string }) =>
      query.sql.includes("LEFT JOIN"),
    ),
  ).toBe(true);
});

test("new files reset a pending delimiter choice", async ({ page }) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page
    .getByText("Source delimiter and file structure", { exact: true })
    .click();
  await page.getByLabel("Delimiter", { exact: true }).selectOption(";");
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "comma.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\nA,Ann\nB,Bob"),
  });
  await expect(page.locator(".source-bar")).toContainText(
    "2 records · 2 columns · Comma separated",
  );
  await page
    .getByText("Source delimiter and file structure", { exact: true })
    .click();
  await expect(page.getByLabel("Delimiter", { exact: true })).toHaveValue("");
});
test("a phone and negative decimal survive an exact valid export", async ({
  page,
}, info) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "phone.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,phone,balance\nA,+44 7700 900123,-12.50"),
  });
  await page
    .getByLabel("Type for balance", { exact: true })
    .selectOption("decimal");
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  await expect(
    page.getByText(/2 cells would gain an apostrophe/),
  ).toBeVisible();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Valid records/ }).click();
  const target = path.join(info.outputDir, "phone.csv");
  await (await waiting).saveAs(target);
  expect(await readFile(target, "utf8")).toContain(
    '"A","+44 7700 900123","-12.50"',
  );
});
test("dialogs are centred at desktop and phone widths and clear uses a styled confirmation", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /How it works/ }).click();
    const rect = await page.getByRole("dialog").boundingBox();
    expect(Math.abs(rect!.x + rect!.width / 2 - width / 2)).toBeLessThan(2);
    expect(rect!.y).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Close guide", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Clear the workspace?");
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  await expect(page.locator(".source-bar")).toContainText(
    "sample-customers.csv",
  );
});
test("several corrections can be saved before one rerun with visible field guidance", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 3, customer_id", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New customer_id", exact: true })
    .fill("C-1099");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Record 3 saved. Results are out of date",
  );
  await expect(
    page.getByRole("button", { name: "03Export files", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Edit record 4, joined", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("YYYY-MM-DD");
  await expect(page.getByRole("dialog")).toContainText(
    "allowed values: active, paused",
  );
  await page
    .getByRole("textbox", { name: "New joined", exact: true })
    .fill("2026-04-03");
  await page
    .getByRole("textbox", { name: "New status", exact: true })
    .fill("active");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("6 valid · 0 requiring review · 0 findings", {
      exact: true,
    }),
  ).toBeVisible();
});
test("duplicate partners can be reached on another page and findings fit a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rows = Array.from(
    { length: 33 },
    (_, i) => `${i === 32 ? "A" : i === 0 ? "A" : "B" + i},Name${i}`,
  );
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "many.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\n" + rows.join("\n")),
  });
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  const summary = await page
    .getByRole("heading", {
      name: "A few records need attention.",
      exact: true,
    })
    .boundingBox();
  expect(summary!.y).toBeGreaterThanOrEqual(0);
  expect(summary!.y).toBeLessThan(150);
  const finding = await page.locator(".finding-cell").first().boundingBox();
  expect(finding!.x).toBeGreaterThanOrEqual(0);
  expect(finding!.x + finding!.width).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Go to record 33", exact: true })
    .click();
  await expect(page.locator("#record-33")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Go to record 1", exact: true }),
  ).toBeVisible();
});

test("allowed values retain keyboard newlines while a real file is configured", async ({
  page,
}) => {
  await page
    .getByLabel("Choose CSV file", { exact: true })
    .setInputFiles(path.resolve("public/samples/needs-review.csv"));
  await page
    .getByLabel("Type for email", { exact: true })
    .selectOption("email");
  await page
    .getByLabel("Type for joined", { exact: true })
    .selectOption("date");
  const values = page.getByLabel("Allowed values for status", { exact: true });
  await values.fill("active");
  await values.press("End");
  await values.press("Enter");
  await values.pressSequentially("paused");
  await expect(values).toHaveValue("active\npaused");
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(
    page.getByText("3 valid · 3 requiring review · 4 findings", {
      exact: true,
    }),
  ).toBeVisible();
});

test("Enter saves a single line identifier without inserting a hidden newline", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 3, customer_id", exact: true })
    .click();
  const id = page.getByRole("textbox", {
    name: "New customer_id",
    exact: true,
  });
  await expect(id).toHaveJSProperty("tagName", "INPUT");
  await id.fill("C-1099");
  await id.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Valid records/ }).click();
  const target = path.join(info.outputDir, "enter.csv");
  await (await waiting).saveAs(target);
  const text = await readFile(target, "utf8");
  expect(text).toContain('"3","C-1099","Amira Osei"');
  expect(text).not.toContain("C-1099\n");
  expect(text).not.toContain("C-1099\r");
});

test("audit downloads record checkbox choices and zero protection is explained accurately", async ({
  page,
}, info) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "phone.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,phone\nA,+441234567890"),
  });
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const getAudit = async (name: string) => {
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: /Audit manifest/ }).click();
    const target = path.join(info.outputDir, name);
    await (await waiting).saveAs(target);
    return JSON.parse(await readFile(target, "utf8"));
  };
  expect(
    (await getAudit("exact.json")).exportOptions.validCsvProtection,
  ).toEqual({ enabled: false, matchingCellCount: 1, affectedCellCount: 0 });
  await page
    .getByRole("checkbox", {
      name: "Add spreadsheet protection to the valid CSV",
    })
    .check();
  expect(
    (await getAudit("protected.json")).exportOptions.validCsvProtection,
  ).toEqual({ enabled: true, matchingCellCount: 1, affectedCellCount: 1 });
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear records", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  await expect(
    page.getByText("No cells match the protection rule.", { exact: false }),
  ).toBeVisible();
});

test("single line record editors stay visibly editable at desktop and phone widths", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Try the sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 3, customer_id", exact: true })
    .click();
  const email = page.getByRole("textbox", { name: "New email", exact: true });
  await email.fill(
    "eleanor.featherstonehaugh.long.address.for.testing@example.test",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const style = await email.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        border: parseFloat(computed.borderLeftWidth),
        borderStyle: computed.borderLeftStyle,
        padding: parseFloat(computed.paddingLeft),
        background: computed.backgroundColor,
        width: el.getBoundingClientRect().width,
        parentWidth: el.parentElement!.getBoundingClientRect().width,
      };
    });
    expect(style.border).toBeGreaterThanOrEqual(1);
    expect(style.borderStyle).toBe("solid");
    expect(style.padding).toBeGreaterThanOrEqual(10);
    expect(style.background).toBe("rgb(255, 255, 255)");
    expect(Math.abs(style.width - style.parentWidth)).toBeLessThan(2);
    await email.focus();
    await expect(email).toBeFocused();
    expect(
      await email.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe("solid");
    await expect(email).toHaveValue(
      "eleanor.featherstonehaugh.long.address.for.testing@example.test",
    );
  }
});

test("editing multiline notes preserves Windows line breaks in the CSV and audit", async ({
  page,
}, info) => {
  await page.getByLabel("Choose CSV file", { exact: true }).setInputFiles({
    name: "notes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('id,notes\r\nA,"Line one\r\nLine two"\r\n'),
  });
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit record 1, notes", exact: true })
    .click();
  const notes = page.getByRole("textbox", { name: "New notes", exact: true });
  await expect(notes).toHaveJSProperty("tagName", "TEXTAREA");
  await notes.press("ControlOrMeta+Home");
  await notes.pressSequentially("First ");
  await notes.press("ArrowDown");
  for (let step = 0; step < 20; step++) await notes.press("ArrowRight");
  await notes.press("Enter");
  await notes.pressSequentially("Line three");
  await expect(notes).toHaveValue("First Line one\nLine two\nLine three");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page.getByRole("button", { name: "Export files", exact: true }).click();
  const csvWaiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Valid records/ }).click();
  const csvPath = path.join(info.outputDir, "notes.csv");
  await (await csvWaiting).saveAs(csvPath);
  expect(await readFile(csvPath, "utf8")).toContain(
    '"First Line one\r\nLine two\r\nLine three"',
  );
  const auditWaiting = page.waitForEvent("download");
  await page.getByRole("button", { name: /Audit manifest/ }).click();
  const auditPath = path.join(info.outputDir, "notes.json");
  await (await auditWaiting).saveAs(auditPath);
  expect(JSON.parse(await readFile(auditPath, "utf8")).edits).toEqual([
    {
      record: 1,
      field: "notes",
      before: "Line one\r\nLine two",
      after: "First Line one\r\nLine two\r\nLine three",
    },
  ]);
});
