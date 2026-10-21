# Format and export reference

## Input

Use UTF-8 with one header row and consistent row widths. The first data record is record 1; quoted multiline values still count as one record. A terminal newline is a separator. Interior blank records remain if they match the header width. A leading byte order mark is accepted. Source headers must be non-empty and distinct, using exact comparison. Target names must also be distinct after trimming for validation.

Papa Parse detects the delimiter. An explicit comma, semicolon, tab or pipe choice reparses the original source and discards current mappings and corrections. Values retain exact whitespace and case. Files are limited to 1,000,000 bytes, 5,000 records and 60 columns.

## Rules

| Rule | Meaning |
| --- | --- |
| Required | At least one non-whitespace character, using JavaScript trim. |
| Text | Any parsed value. |
| Integer | Optional minus sign, then zero or a nonzero digit followed by digits. No padding, plus, leading zeros or scientific notation. |
| Decimal | Integer format optionally followed by a dot and digits. No comma decimal or thousands separator. Values stay text, avoiding numeric precision conversion. |
| Date | YYYY-MM-DD and a real calendar date. 03/04/2026 fails rather than being guessed. |
| Email | Basic non-whitespace local@domain.suffix structure; no delivery or ownership verification. |
| Unique key | Exact case-sensitive uniqueness for one field. Every record in a duplicate group fails. Blank values are ignored; use Required to reject blanks. Multiple selected keys are separate, not a composite key. |
| Allowed values | Exact case-sensitive membership, at most 500 lines per field. Empty lines are omitted, other whitespace remains. Blank values are handled by Required. |

Optional blanks pass type and reference checks. Multiple rules can produce multiple findings for a record. SQLite uses fixed internal identifiers; values and reference parameters are bound. The displayed SQL is read only.

## Corrections

A cell opens the full source record for explicit changes. Saving clears the validation result and disables export until a new run. Changes remain in memory. There is no undo history, saved mapping or persistent recovery. Replacing or clearing a file discards its workspace.

## Exports

CSV files use quoted comma-separated cells, escaped quotes and CRLF endings. Formula-like values, including headers, gain a leading apostrophe if they begin with a tab or line break, or optional whitespace followed by =, +, @ or -. This also affects negative-looking numbers. There is no automatic reversal for a destination. Test a small export with your receiving importer.

- import-ledger-valid.csv contains a distinct source-record metadata column and mapped target fields for passing records. Unmapped source columns are omitted. Optional unmapped targets are empty.
- import-ledger-rejected.csv retains every source column, explicit corrections, a record number and issue summary. Metadata names start at _source_record and _issues, adding leading underscores until distinct from real headers.
- import-ledger-audit.json uses import-ledger/audit-v1. It records source name, headers, delimiter, record count, original source SHA-256, current mapping and references, counts, exact before/after edits, export metadata names, findings, SQL and bound parameters.

The fingerprint hashes the decoded original UTF-8 text encoded as UTF-8, including a supplied byte order mark. It is not a signature. The manifest can contain sensitive values, but not every unchanged source value. It is not an anonymised report, an authenticated timestamp or proof of destination acceptance. Unchanged data and rules give deterministic exports.
