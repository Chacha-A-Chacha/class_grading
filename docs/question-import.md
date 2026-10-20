# Question JSON import

Admin → Question bank → Import JSON. Every question is validated first and the result
is shown per question. Nothing is saved until you confirm, and the confirmation is all
or nothing: if any question is invalid, none are imported. Imported questions start as
**drafts**; review and activate each one before it can appear in an assessment.

A retried confirmation (for example after a lost connection) returns the original result
instead of creating duplicates. Choosing the file again starts a new import.

See [the example file](../public/question-import-example.json), also downloadable from
the import page.

## File format

UTF-8 JSON, at most 2 MB and 200 questions: either an array of questions or an object
with a `questions` array.

| Field | Required | Rules |
| --- | --- | --- |
| `kind` | yes | `"CODE"` or `"THEORY"`. |
| `answerMode` | no | `"SINGLE"` (default): exactly one correct option. `"MULTIPLE"`: select all that apply, scored all-or-nothing. |
| `prompt` | yes | Up to 5,000 characters. Plain text; HTML is shown as text, never run. |
| `code` | for `CODE` | Up to 10,000 characters. Indentation is kept exactly; use `\n` for new lines. |
| `language` | for `CODE` | Up to 40 characters, e.g. `"javascript"`. |
| `runtimeContext` | for `CODE` | Up to 500 characters. Resolve ambiguity, e.g. `"Node.js 24, CommonJS script"` or `"Browser, ES module"`. |
| `objective` | yes | Learning objective, up to 160 characters. |
| `topics` | yes | 1–5 distinct names, up to 80 characters each. Matched to existing topics ignoring case. |
| `difficulty` | yes | `"EASY"`, `"MEDIUM"` or `"HARD"`. |
| `expectedSeconds` | yes | Whole number from 10 to 1800. |
| `explanation` | yes | Up to 5,000 characters. Shown to students only after results are released. |
| `options` | yes | 2–6 options. `SINGLE`: exactly one has `"correct": true`. `MULTIPLE`: 3–6 options and at least one correct. |

Each option:

| Field | Required | Rules |
| --- | --- | --- |
| `content` | yes | Up to 2,000 characters; options must differ from each other. |
| `kind` | no | `"TEXT"` (default) or `"CODE"` for a code block. |
| `correct` | no | `true` on the correct option (`SINGLE`) or on every correct option (`MULTIPLE`); omit or `false` on the rest. |

Multiple-select questions earn the point only when a student selects exactly the correct
set: a missing or extra choice scores zero, and there is no negative marking.

Options are shuffled for each student, so answers that refer to other options
("All of the above", "None of the above", "Both A and B") are rejected.

## After import

1. Filter the question bank by **Draft**.
2. Open each question, check the **Student view** and **Answer and explanation** tabs,
   edit if needed, then choose **Activate after review**.
   If the file was already reviewed before uploading, filter the bank (for example by
   status **Draft** and topic **S12 Week 00**) and use **Activate all drafts** instead.
   It activates every draft matching the filter, all or nothing, after you confirm the
   review; each activation is recorded in the audit history.
3. Activated content is frozen. To change it, choose **Create new version**; the active
   version stays in use until the new draft is activated.
