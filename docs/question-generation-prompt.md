# Prompt: build the Season 12 Code Logic question bank

Give this whole document to the model or agent session that writes the questions. It is
self-contained: it names every source, rule, format and check needed. Nothing else is
required except read access to the two repositories below, a shell with Node.js 24, and
web access for the research step.

---

## Your role and goal

You are an experienced web-development instructor and assessment designer. Write a bank of
**multiple-choice questions** for the IYF Weekend Academy, Season 12, a 12-week course
(plus Week 0) that runs HTML/CSS → command line and Git → JavaScript → DOM and events →
async and APIs → storage and testing → React → Node/Express → databases and auth →
full-stack deployment.

The questions run in **Code Logic Assessments**, a timed exam app. Each question is worth
one point with no negative marking. Most questions have exactly one correct option
(`"answerMode": "SINGLE"`, the default); "select all that apply" questions
(`"answerMode": "MULTIPLE"`) earn the point only when the student picks exactly the correct
set. Options are shuffled for every student. Assessments are assembled from the bank by
topic, question type (CODE or THEORY) and difficulty, and several parallel sets are
generated with at most 30% shared questions. That means the bank needs **depth in every topic, at every
difficulty**, not one question per idea.

The questions must be:

1. **Faithful to the course.** Every question tests something the lessons actually teach,
   at the depth they teach it, using the course's own terminology, examples and runtime.
2. **Complete in coverage.** Every lesson and every learning objective is assessed.
3. **Hard to guess, fair to answer.** A student who understands the concept answers with
   confidence; a student who half-understands it is drawn to a specific, realistic wrong
   answer. No trick wording, no ambiguity, no trivia.
4. **Informed by the real world.** Shaped by common interview questions, standard test
   and certification items, and current (2025–2026) practice, but only within the
   syllabus.

---

## Sources (read all of these first)

Repository: `C:\Users\USER\Documents\GitHub\IYF-weekend_academy\season-12\`

| Source | What to take from it |
| --- | --- |
| `course_outline.md` | The authoritative syllabus: weeks, the 24 lessons, and each lesson's **"By the end you can…"** bullets. These bullets are the learning objectives. |
| `tasks/week-NN-*/README.md` (weeks 00–12) | Exactly what students build and practise, the example code they see, difficulty-tagged tasks (🟢 beginner, 🟡 intermediate, 🔴 challenge), daily challenges, and code with expected output (e.g. the Week 6 "Predict the output" item). |
| `lesson-notes/week-NN-*/lesson-NN-notes.md` | Teaching notes. Use the **Exit Ticket** (concept checks with answers), the **Common Pitfalls & Fixes** tables (the best source of wrong answers) and the **Keyword Recap** glossaries. Also use the `lesson-NN-exercise.*` / `lesson-NN-solution.*` pairs. |
| `lesson-notes/live-sessions/` | Live demo scripts (Weeks 0–3 skills, merge conflicts). |
| `MARKING_GUIDE.md`, section D3 "Concept focus per week" | A compact list of the concepts each week is expected to master. |
| `IMPROVEMENTS.md` | What changed from Season 11; do not test removed or replaced material. |

Season 12 lesson notes are missing for Weeks 0, 7, 10 and 12. For those weeks, use the
outline and task READMEs first, then the Season 11 notes in
`C:\Users\USER\Documents\GitHub\IYF-weekend_academy\season-11\lesson-notes\` only where
the Season 12 outline teaches the same thing. The Season 12 outline always wins on scope.

App rules (do not change these files; follow them):

- `C:\Users\USER\Documents\GitHub\class_grading\docs\question-import.md`: the import format.
- `C:\Users\USER\Documents\GitHub\class_grading\src\shared\questions.ts`: the validator
  every file must pass.
- `C:\Users\USER\Documents\GitHub\class_grading\public\question-import-example.json`: a
  valid example file.

The lesson notes, marking guide and anything containing answers are **instructor-private**.
Never copy them, or the questions you write, anywhere students can see them.

---

## Step 1: Build the coverage matrix before writing anything

From the sources, build a matrix with one row per learning objective:

`Week | Lesson | Learning objective (from the outline, ≤160 characters) | Key concepts | Known misconceptions and pitfalls | Runtime (browser, Node.js, shell, none)`

- Use the outline's "By the end you can…" bullets as the objectives, lightly shortened to
  fit 160 characters without changing meaning.
- List the misconceptions from the Pitfalls tables, exit tickets and the research below.
- Mark concepts that are central to later weeks (for example closures, `this`, the event
  loop, references vs copies, state immutability). They need more questions.

Save the matrix as `coverage.md` in the output folder (see "Output"). Every question you
write must map to one row, and every row must end up with questions.

---

## Step 2: Research (shapes the questions; never copy them)

Research three kinds of questions for each week's concepts. Use the findings to choose
**which misconceptions to target and which scenarios are realistic**, then write
original questions in the course's own context. Never reproduce a question, snippet or
option set verbatim from a source.

1. **Interview questions.** What junior and mid-level front-end, JavaScript, React and
   Node interviews actually ask. Good sources: MDN (concept guides and "common mistakes"),
   javascript.info (tasks at the end of each chapter), roadmap.sh, the Front End Interview
   Handbook, GreatFrontEnd's question lists, and well-known "JavaScript output" question
   collections. Typical themes: hoisting and the temporal dead zone, closures in loops,
   `this` binding, `==` vs `===`, coercion, reference vs value, `map` vs `forEach`,
   microtasks vs macrotasks, promise chaining and error handling, event delegation and
   bubbling, React keys, stale closures in `useEffect`, dependency arrays, controlled
   inputs, REST status codes, middleware order, SQL joins, password hashing, JWT storage,
   CORS.
2. **Test and certification items.** The style of standard knowledge checks (freeCodeCamp,
   W3Schools quizzes, MDN learning-area assessments, entry-level web certification
   syllabi). Use them to calibrate what "easy" means and to catch fundamentals the course
   expects but might not repeat.
3. **Trending, current practice (2025–2026).** Only where it falls inside a lesson's
   scope, for example: `structuredClone`, `Array.prototype.toSorted`/`with`/`findLast`,
   `Object.groupBy`, optional chaining and nullish coalescing, `fetch` built into Node.js,
   top-level `await` in modules, CSS `:has()`, nesting and container queries,
   `git switch`/`git restore`, React 19 behaviour of familiar hooks, Vite defaults, the
   Node.js built-in test runner versus Vitest, current OWASP Top 10 categories, secure
   cookie and token-storage guidance. **At most 15% of a week's questions** may be
   trend-led, and each must still test a concept the lessons teach. Never test a feature
   the course never introduces.

Record in `research.md` (output folder) the sources you consulted per week and, for each,
which misconceptions or scenarios you took from it. This is an audit trail, not a copy of
their questions.

---

## Step 3: Quantity, mix and difficulty

Per lesson (24 lessons), write **at least 12 questions**. Write **at least 8 for Week 0**.
That is roughly 300 questions in total.

| Lesson type | Lessons | CODE | THEORY |
| --- | --- | --- | --- |
| Programming | 7–23 | at least 8 | at least 4 |
| Foundations | Week 0, 1–6, 24 | at least 6 (HTML, CSS, shell, Git or config snippets) | at least 6 |

Week 0 needs at least 3 CODE and 3 THEORY.

Difficulty per lesson: about **25% EASY, 45% MEDIUM, 30% HARD**, with **at least 3 of each**
(Week 0: at least 2 of each).

With only 12 questions per lesson, these rules can pull against each other. When they do,
keep them in this order and relax the later ones first: correctness and one defensible
answer; objective coverage; CODE/THEORY minimums; difficulty minimums; per-week caps
(2-option, true/false, multiple-select, combination, trend-led); format variety; option-count mix. Record
every relaxation in `coverage.md`.

- **EASY:** one concept, one step, a direct application. Still not answerable by elimination.
- **MEDIUM:** two interacting concepts, or one concept in an unfamiliar arrangement, or
  reading 6–15 lines of code carefully.
- **HARD:** a classic misconception sits exactly on the path to the answer (for example
  microtask before timeout, a closure capturing a reassigned variable, a mutation through
  a shared reference, a missing `return` in an arrow function with braces, middleware
  order, a stale state value). The student must trace precisely, not recognise a pattern.

`expectedSeconds`: about 30–45 for EASY, 45–90 for MEDIUM, 75–150 for HARD, plus about 5
seconds per line of code beyond 10 lines (including code in options). Stay within 10–1800.

### Question formats (use a real variety)

Each lesson must use **at least five different formats** from this list, and no single
format may exceed 40% of a week's questions. Choose the format that tests the concept
best; any other format is welcome if it follows the rules in Step 4.

| Format | Shape | Typical options |
| --- | --- | --- |
| Predict the output | Code in `code`; "What is logged / rendered / returned?" | Exact outputs (often multi-line, `CODE` kind) |
| Find the bug | Code with numbered lines; "Which line causes …?" or "Why does … fail?" | Line numbers, or causes |
| Fix the bug | Broken code and its symptom; "Which change fixes it?" | Code snippets |
| Choose the correct snippet | Requirement in the stem (plus shared context such as data, markup or a route in `code`); "Which implementation …?" | 2–6 code snippets |
| Compare two snippets | Two versions in `code`; "What is the difference in behaviour?" | Statements |
| Complete the code | Code with a marked gap (`/* ? */`); "What belongs in the gap?" | Expressions or lines |
| Order of execution | Async, event or middleware code; "In what order …?" | Orderings (6 options is natural) |
| Error identification | "What happens when this runs?" | Named errors and outputs, e.g. `ReferenceError: x is not defined` |
| Concept application | A short scenario (CommunityHub, to-do list, weather app); "What should you use / what happens?" | Statements |
| Terminal / Git outcome | A sequence of commands; "What is the state after …?" | Branch states, file contents, command output |
| HTTP and API | A request and route; "What status / response?" | Status codes, response bodies |
| Accessibility / semantics review | Markup in `code`; "Which problem …?" | Statements or corrected markup |
| True or false (2 options) | One precise claim | True / False (≤10% per week) |
| Select all that apply (`answerMode: MULTIPLE`) | "Which of these … ? Select all that apply." | 3–6 independently true/false options; all-or-nothing |
| Combination | Numbered statements or snippets; "Which are true?" (single answer) | Combinations of the numbers |

**Kind:** a question is `"CODE"` whenever the student must read code to answer, in the
stem or the options. CODE questions need a `code` field, so for "Choose the correct
snippet" and similar formats put the shared context (the data, markup, route or test the
snippets act on) in `code`. Only when there is truly no shared context, make it a
`"THEORY"` question with `"CODE"`-kind options.

---

## Step 4: Writing rules

### The stem (`prompt`)

- Ask one clear question. Use the course's terminology and naming (for example the
  CommunityHub app, the to-do list and weather examples, local names rather than
  "John Doe").
- Prefer realistic scenarios: "A student's to-do list…", "Your Express route…", "The
  CommunityHub feed shows…".
- Ask positively. Never use double negatives. If you must ask for the incorrect one, write
  **NOT** in capitals and make sure only one option is incorrect.
- Do not give the answer away through wording, grammar or a repeated keyword.
- Plain text only. HTML in a prompt is shown as text, never rendered. Put code in the
  `code` field, never inline in the prompt (short inline names like `map` are fine).

### The code (`code`, CODE questions only)

- 3–25 lines, the minimum that makes the point. Indentation must be exact; use `\n` for
  new lines in JSON.
- Code must be correct and runnable as stated, except where the question is about a bug.
  No pseudo-code, no undeclared helpers, no reliance on unstated globals.
- Set `language` (`javascript`, `jsx`, `html`, `css`, `bash`, `sql`, `json`) and a precise
  `runtimeContext` that removes all ambiguity. Take versions (Node.js, React, Express,
  Vite, Vitest, Mongoose, database) from the course's own `package.json` files, task
  READMEs and lesson notes, not from the examples below. Where the course does not pin a
  version, use the current stable major, write it in the runtime context, and list the
  assumption in `coverage.md` under "Assumed versions". Never write a question whose answer
  differs between versions the course could plausibly use (for example Express 4 versus 5
  async error handling) without naming the version. Examples of the shape:
  - `Browser, classic script` / `Browser, ES module`
  - `Node.js 24, ES module` / `Node.js 24, CommonJS script`
  - `React 19 with Vite, StrictMode off`
  - `Express 5 on Node.js 24`
  - `SQLite 3`
  - `bash on Ubuntu, Git 2.4x`
  - `Modern evergreen browser, no CSS reset`
- If output order or timing matters, say whether everything runs at top level and whether
  any `await` happens.

### The options

- **Choose the number of options from the nature of the question: anywhere from 2 to 6.**
  There is no default. Use as many options as there are *plausible, distinct* answers,
  and no more:
  - **2** for genuinely binary judgements (true/false, "does this throw or not", "same or
    different reference"). A blind guess scores 50%, so keep 2-option questions to at
    most **10% of each week** and never at HARD unless the reasoning is long.
  - **3** when exactly two misconceptions are realistic.
  - **4–5** for most output, behaviour and concept questions.
  - **6** when the answer space is naturally wide: orderings of four or more log lines,
    status-code choices, which of several lines is the bug, combination answers. HARD
    questions should usually have 4–6 options to keep guessing low.
  Never pad with filler to reach a count; never cut a strong misconception to stay short.
  Across each week, use a real mix of counts: no single count above 60% of the questions.
- **Options can be anything the question needs**: plain statements, exact outputs, single
  values, whole code snippets (functions, JSX components, CSS rules, SQL queries, shell
  commands, Express routes), line numbers, HTTP status codes, file paths or Git
  commands. Mixed types within one question are not allowed: all options are the same kind
  of thing.
- **Correct options:** single-answer questions (`"answerMode": "SINGLE"`, the default) have
  exactly one correct option; multiple-select questions (`"answerMode": "MULTIPLE"`) have one
  or more (see below). Every correct option must be correct under the stated runtime,
  beyond argument, and every other option must be clearly wrong.
- **Every distractor is a real misconception** taken from the matrix: the Pitfalls tables,
  exit tickets or research. For each wrong option you must be able to name the mistaken
  belief that leads to it. No filler, no joke options, no options nobody would choose.
- Make options **parallel in length, structure and precision**. The correct answer must
  not be the longest, the most qualified or the only technical-sounding one.
- For output questions, include the outputs that the common wrong mental models produce
  (for example the synchronous-order answer to an event-loop question, the
  shared-reference answer to a copy question, `undefined` versus `ReferenceError` for
  hoisting).
- Avoid `"Error"` as a vague option. If an error is an option, name it: for example
  `TypeError: Assignment to constant variable.`
- Options are **shuffled per student**, so never write "All of the above", "None of the
  above", "Both A and B" or anything that refers to another option or a position. The app
  rejects these.
- Use `"kind": "CODE"` for options that are code or exact output where whitespace
  matters; `"TEXT"` otherwise. Every option must differ from every other.
- **Code-snippet options** must each be complete and syntactically valid on their own
  (unless the question is about a syntax error), use identical formatting and naming
  apart from the point being tested, and differ by the concept, not by noise. Keep each
  snippet short enough to compare side by side (ideally 1–8 lines). Run every snippet
  option during verification, not just the correct one.

### Several correct answers in one question

**Multiple-select ("select all that apply")** — set `"answerMode": "MULTIPLE"` and mark
every correct option `"correct": true`. Students see checkboxes and the instruction "Select
all that apply". Scoring is **all-or-nothing**: one point only for exactly the correct set;
a missing or extra choice scores zero.

- 3–6 options; at least one correct. Vary the number of correct options across the bank
  (one, two, three, occasionally all), so students cannot assume "it is always two".
- Each option must be independently true or false under the stated runtime; never let two
  options be true only together.
- Every wrong option still needs a named misconception; every correct option should be one
  that a half-understanding student might wrongly reject.
- The explanation must say, for **each** option, why it is or is not correct.
- Use multiple-select for at most **20% of each week's questions**, mostly MEDIUM and HARD,
  and add about 15 seconds to `expectedSeconds` (every option must be judged).

**Combination format** — a single-answer alternative when the numbered items are long
(several code snippets or multi-line statements) or when you want to test one specific
mixture:

- Put numbered statements, lines or snippets **in the stem or the `code` field**
  (1, 2, 3, 4 — numbers, not letters, because option letters are reassigned when options
  are shuffled).
- Make each option a combination that refers only to those numbers, for example
  `1 and 3 only`, `2 only`, `1, 2 and 4 only`, `None of the numbered statements`.
  Referring to numbered items in the stem is allowed; referring to other *options*
  ("both of the above") is not.
- Use 4–6 combination options, chosen so that each wrong combination corresponds to a
  specific misconception (for example including a statement that sounds right but is
  false under the stated runtime).
- Keep it to at most 5 numbered items and at most **15% of each week's questions**; these
  questions take longer, so add about 20 seconds to `expectedSeconds`.

Do not invent any other JSON shape for multi-answer questions; the importer accepts only
`answerMode` with `correct` flags on the options.

### The explanation

Write 2–6 sentences that:

1. state why the correct answer is right, tracing the mechanism (for example "the
   `.then` callback is a microtask, so it runs before the `setTimeout` callback");
2. name the misconception behind each tempting wrong answer;
3. where useful, point to the lesson concept to revisit (for example "Lesson 11: the
   event loop").

Students see explanations only after results are released.

### Topics (the blueprint uses these, so spelling must be exact)

Give every question **one week topic and one to three concept topics** (five at most):

- The week topic is exactly `S12 Week 00` … `S12 Week 12`.
- The concept topics come from this canonical list; reuse the exact spelling:

| Week | Concept topics |
| --- | --- |
| 0 | Git basics · GitHub collaboration · Markdown |
| 1 | How the web works · Semantic HTML · Accessibility · HTML forms |
| 2 | CSS cascade and specificity · Box model · Flexbox · CSS Grid · Responsive design |
| 3 | Command line · Git branching and merging |
| 4 | JavaScript types and operators · Functions and scope · Control flow · Arrays and array methods · Objects and JSON |
| 5 | DOM manipulation · Events and delegation · Form validation |
| 6 | Event loop · Promises and async/await · Fetch and REST APIs |
| 7 | Web storage and state · Code quality · Testing with Vitest |
| 8 | React components and props · React state |
| 9 | React effects and data fetching · React Router · Custom hooks · React accessibility and styling |
| 10 | Express routing · Express middleware · REST and CRUD · Error handling |
| 11 | SQL basics · MongoDB and Mongoose · Authentication and security |
| 12 | Full-stack integration · CORS · Deployment and environment variables |

The week topic is always the week the lesson belongs to, but a concept topic may come from
any row when the lesson teaches it. For example, Lesson 1 (clone, commit, push, GitHub
Pages) uses `S12 Week 01` with `Git basics` or `Deployment and environment variables`.

The importer **creates any topic name it does not recognise** (matching ignores case), so
a misspelt topic does not fail the import; the question just silently drops out of every
blueprint. The validation script in Step 6 rejects names outside this list. If a concept
needs a topic that is not listed, stop and list the proposed new topic in `coverage.md`
under "Proposed topics" with a reason. Do not invent topics silently.

### Objective and difficulty

- `objective` is the learning objective from your matrix row (≤160 characters),
  identical wording for every question on that objective.
- `difficulty` is `EASY`, `MEDIUM` or `HARD` per Step 3.

### Things that make a question unacceptable

- More than one defensible answer, or an answer that depends on an unstated browser,
  version, flag or setting.
- Testing memorised trivia (exact method names nobody needs to remember, release dates,
  author names) instead of understanding.
- Testing anything outside the Season 12 lessons.
- A stem or code copied from a website, book or question collection.
- A question that is easier with the options than without them (the options leak the
  answer).
- Near-duplicates: two questions testing the same point with the same snippet shape.
  Vary the scenario and the misconception targeted.
- Offensive, culturally narrow or distracting content.

---

## Step 5: Verify every question (mandatory)

1. **Run the code.** For every CODE question whose answer is output, behaviour or an
   error, execute the snippet and confirm the correct option matches exactly.
   - JavaScript in Node: `node --input-type=module -e "…"` or a temporary file; use
     CommonJS only when the runtime context says so.
   - Browser-only code (DOM, events, `localStorage`, `fetch` in the browser): run it in a
     headless browser (for example Playwright with Chromium) or, for pure DOM logic, with
     `jsdom`. If you cannot run it, mark the question `"needs manual check"` in
     `verification.md` and do not include it in the import file.
   - SQL: run it in `sqlite3` with the schema and data shown.
   - Shell and Git: run in a temporary directory with a fresh repository.
   - React: render with Vite or React Testing Library in a temporary project.
   Delete all temporary files afterwards.
2. **Check every wrong option.** Where an option is code or an output, run it and confirm
   it is wrong under the stated runtime. Where it is a statement, cite the source (lesson
   note, MDN page or spec section) that shows it is false.
3. **Blind test.** Cover the options, answer the stem, then check your answer appears
   exactly once among the options (for multiple-select: that the set you chose is exactly
   the options marked correct).
4. **Review the explanation** against the actual run output.
5. Log each question in `verification.md`:
   `id | week | lesson | format | trend-led (yes/no) | method (node, browser, sqlite, shell, reasoning) | result | notes`.

---

## Step 6: Output

Write the files to this folder, which git already ignores, so answers never reach
students:

`C:\Users\USER\Documents\GitHub\IYF-weekend_academy\season-12\lesson-notes\question-bank\`

| File | Contents |
| --- | --- |
| `week-00.json` … `week-12.json` | One import file per week |
| `coverage.md` | The matrix; question counts per lesson × kind × difficulty, per format, and per option count; and the list of objectives with fewer than 3 questions (which must be empty) |
| `research.md` | Sources consulted per week and what each contributed |
| `verification.md` | The verification log from Step 5 |

Each JSON file is UTF-8, at most 200 questions and 2 MB, in exactly this shape (see
`docs/question-import.md` for the full field rules):

```json
{
  "questions": [
    {
      "kind": "CODE",
      "prompt": "What does this snippet log?",
      "code": "console.log('A');\nsetTimeout(() => console.log('B'), 0);\nPromise.resolve().then(() => console.log('C'));\nconsole.log('D');",
      "language": "javascript",
      "runtimeContext": "Node.js 24, ES module",
      "objective": "Explain the order in which synchronous code, microtasks and timers run",
      "topics": ["S12 Week 06", "Event loop", "Promises and async/await"],
      "difficulty": "MEDIUM",
      "expectedSeconds": 60,
      "explanation": "Synchronous logs run first (A, D). The .then callback is a microtask, so it runs before the setTimeout callback, which is a macrotask (C, then B). Choosing A B C D assumes code runs top to bottom; choosing A D B C assumes a 0 ms timer runs before promise callbacks; choosing A C D B assumes a resolved promise's callback runs synchronously.",
      "options": [
        { "kind": "CODE", "content": "A\nD\nC\nB", "correct": true },
        { "kind": "CODE", "content": "A\nB\nC\nD" },
        { "kind": "CODE", "content": "A\nD\nB\nC" },
        { "kind": "CODE", "content": "A\nC\nD\nB" }
      ]
    }
  ]
}
```

Field limits enforced by the app: `prompt` ≤5,000 characters; `code` ≤10,000;
`language` ≤40; `runtimeContext` ≤500; `objective` ≤160; `explanation` ≤5,000;
1–5 distinct topics of ≤80 characters; `expectedSeconds` an integer 10–1800;
2–6 distinct options of ≤2,000 characters; `"answerMode": "SINGLE"` (default) needs
exactly one `"correct": true`, `"MULTIPLE"` needs 3–6 options with at least one.
`code`, `language` and `runtimeContext` are required when `kind` is `"CODE"` and must be
omitted or `null` for `"THEORY"`.

**Validate every file before finishing.** From the class_grading folder, create this
script in a temporary folder outside the repository, run it, then delete it:

```ts
// validate-bank.ts — run from class_grading with: npx tsx <path>/validate-bank.ts <file.json> [...]
import { readFileSync, statSync } from "node:fs";
import { MAX_IMPORT, validateImport } from "C:/Users/USER/Documents/GitHub/class_grading/src/shared/questions";

const CONCEPTS = [
  "Git basics", "GitHub collaboration", "Markdown",
  "How the web works", "Semantic HTML", "Accessibility", "HTML forms",
  "CSS cascade and specificity", "Box model", "Flexbox", "CSS Grid", "Responsive design",
  "Command line", "Git branching and merging",
  "JavaScript types and operators", "Functions and scope", "Control flow", "Arrays and array methods", "Objects and JSON",
  "DOM manipulation", "Events and delegation", "Form validation",
  "Event loop", "Promises and async/await", "Fetch and REST APIs",
  "Web storage and state", "Code quality", "Testing with Vitest",
  "React components and props", "React state",
  "React effects and data fetching", "React Router", "Custom hooks", "React accessibility and styling",
  "Express routing", "Express middleware", "REST and CRUD", "Error handling",
  "SQL basics", "MongoDB and Mongoose", "Authentication and security",
  "Full-stack integration", "CORS", "Deployment and environment variables",
];
const WEEK = /^S12 Week (0\d|1[0-2])$/;

let failed = 0;
const fail = (msg: string) => { failed++; console.log(msg); };
const seen = new Map<string, string>();
for (const file of process.argv.slice(2)) {
  if (statSync(file).size > 2 * 1024 * 1024) fail(`${file}: larger than 2 MB`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const items: unknown[] | undefined = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(items) || items.length === 0) { fail(`${file}: no "questions" array`); continue; }
  if (items.length > MAX_IMPORT) fail(`${file}: ${items.length} questions, at most ${MAX_IMPORT}`);
  const { report } = validateImport(items);
  for (const r of report.filter((r) => r.errors.length)) fail(`${file} #${r.index}: ${r.errors.join("; ")}`);
  items.forEach((item, i) => {
    const q = item as { prompt?: string; code?: string | null; topics?: string[] };
    const topics = q.topics ?? [];
    const weeks = topics.filter((t) => WEEK.test(t));
    if (weeks.length !== 1) fail(`${file} #${i + 1}: needs exactly one week topic, found ${weeks.length}`);
    for (const t of topics) if (!WEEK.test(t) && !CONCEPTS.includes(t)) fail(`${file} #${i + 1}: unknown topic "${t}"`);
    const key = `${q.prompt?.trim()}\u0000${q.code?.trim() ?? ""}`;
    if (seen.has(key)) fail(`${file} #${i + 1}: same prompt and code as ${seen.get(key)}`);
    else seen.set(key, `${file} #${i + 1}`);
  });
  console.log(`${file}: ${report.length} questions checked`);
}
process.exitCode = failed ? 1 : 0;
```

It runs the app validator, enforces the file limits, rejects topics outside the canonical
list, requires exactly one week topic per question, and reports questions that share the
same stem and code across all files given. Run it on all thirteen files in one call; it
must exit with zero errors.

---

## Step 7: Final self-review checklist

Before declaring the bank finished, confirm each item and state the result in
`coverage.md`:

- [ ] Every learning objective in the outline has at least 3 questions, including at least
      one MEDIUM or HARD.
- [ ] Every lesson meets the counts in Step 3, including at least 3 of each difficulty
      (Week 0: 2), and every rule relaxed under the Step 3 priority order is recorded.
- [ ] Every runtime version comes from the course materials or is listed under "Assumed
      versions".
- [ ] Every week topic `S12 Week 00`–`S12 Week 12` has CODE and THEORY questions at EASY,
      MEDIUM and HARD (so assessments can draw parallel sets).
- [ ] Every CODE question was executed, or is excluded and marked for manual checking.
- [ ] Every distractor maps to a named misconception.
- [ ] No option is "All/None of the above" or refers to another option.
- [ ] Option counts follow each question's nature (2–6): 2-option questions ≤10% per week,
      no single count above 60% of a week, HARD questions mostly 4–6 options.
- [ ] Each lesson uses at least five formats from the formats table; no format exceeds
      40% of a week; multiple-select ≤20% and combination ≤15% per week.
- [ ] Multiple-select questions vary their number of correct options, and each explanation
      covers every option.
- [ ] Every code-snippet option was run, not only the correct one.
- [ ] Correct answers are spread evenly across option positions in the file (the app
      shuffles, but it keeps editing honest).
- [ ] Trend-led questions are at most 15% per week and all within lesson scope.
- [ ] No question or snippet is copied from a source.
- [ ] All JSON files pass the validation script with zero errors: no unknown topics, one
      week topic per question, no duplicate stem and code.

Finally, report: totals per week, kind and difficulty; any proposed new topics; questions
excluded for manual checking; and anything in the course materials that looked wrong or
contradictory while you worked.

---

## After generation (for the instructor)

Import each week's file in the app (Admin → Question bank → Import JSON). Imported
questions start as **drafts**: preview each one in the Student view and Answer tabs,
fix anything you disagree with, then activate. For a gate assessment, build the blueprint
from week topics, for example Week 6 gate: slots on `S12 Week 04`–`S12 Week 06`, mixing
CODE and THEORY across EASY, MEDIUM and HARD.
