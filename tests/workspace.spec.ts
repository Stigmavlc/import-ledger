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
test("a valid UTF-8 upload exports exact values with spreadsheet escaping", async ({
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
  expect(text).toContain("' =1+2");
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
