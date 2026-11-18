# Reusable AI prompt: convert a question pool for BankShield

In the admin portal, enter the broad quiz topic and copy the prepared prompt. Paste it into an AI chat, then paste or attach your question pool. The AI should return one JSON document that can be saved as a `.json` file and uploaded directly to the portal.

---

## Prompt to give an AI

You are converting a supplied training question pool into the BankShield quiz import format. Read the entire source pool before converting it.

### What to do

1. Convert each source question into exactly one object in the `questions` array. Preserve its meaning and the supplied correct answer. Do not invent policies, facts, choices, explanations, or answer keys.
2. Assign each question a `type` from this exact list: `single`, `multi`, `match`, `order`, `diff`, `tabletop`, `branch`. This field classifies the answer interaction. Separately, automatically organize the questions into useful subject categories: infer concise category names from the supplied questions, group related questions consistently, and put the category name in each question's required `topic` field. Do not ask the administrator to provide category names. Use roughly 3 to 10 categories when the size and content of the pool support it; do not invent unrelated categories.
3. If the source does not clearly establish the correct answer, question type, or branch logic, stop and ask concise clarification questions. Do not guess and do not produce a partially invented pool.
4. Use JSON types exactly as specified below. All answer indexes are zero-based: index `0` means the first choice.
5. Give every question a unique integer `id`. Use the supplied quiz topic as the overall subject, then set each question's `topic` to the most suitable automatically inferred category within that subject. Keep category labels short and consistent across the pool. Use a concise `formatLabel` and a difficulty of `Basic`, `Intermediate`, or `Advanced`.
6. Set `questionCount` to the number of questions candidates should receive, between 5 and 93, and no greater than the number of questions in the pool. Use 25 when the user has not specified a quiz length and the pool has at least 25 questions. If there are fewer than five source questions, ask the user for more questions instead of outputting an invalid pool.
7. Use a `timeLimitMinutes` from 1 to 180. Use 15 when the user has not specified a limit.
8. Before responding, check that every id is unique, every index is in range, every required field is present, and every branch path has exactly three decisions followed by `END`.

### BankShield JSON format

Return one JSON object with this root structure and no additional root properties:

```json
{
  "name": "A clear name for this quiz",
  "questionCount": 25,
  "timeLimitMinutes": 15,
  "questions": []
}
```

Every question must include `id`, `topic`, `type`, `prompt`, `explanation`, `difficulty`, and `formatLabel`.

Use these type-specific fields:

- `single`: `options` is an array of at least two strings; `answer` is the integer index of the one correct option.
- `multi`: `options` is an array; `answer` is a non-empty array of distinct correct option indexes.
- `match`: `left` and `right` are arrays of equal length; `answer` has one right-side index for each `left` item, in `left` order.
- `order`: `options` is an array; `answer` lists every option index exactly once in the correct sequence.
- `diff`: `evidence` is an object with `a` and `b` objects of labeled evidence values; `options` is an array of findings; `answer` is a non-empty array of correct finding indexes.
- `tabletop`: `options` is an array of actions; `answer` is a non-empty array of safe/correct action indexes.
- `branch`: `nodes` is an array of decision nodes. Each node has a unique `id`, a `prompt`, an `options` array, and an integer `answer` index. Each option has `text` and `next`, where `next` is another node id or `END`. Start at node id `s1`; every possible path must contain exactly three decisions and then reach `END`; do not create cycles or missing node references.

For all types, `explanation` should briefly teach why the correct response is appropriate. Do not include real customer, employee, account, or confidential data. Preserve fictional examples only.

### Output rules

- If the source is complete and unambiguous, return only the JSON object: no Markdown code fences, no introduction, no notes, and no trailing comments. It must parse with `JSON.parse` and be ready to save as `my-question-pool.json` and upload.
- If clarification is required, ask only the questions needed to make a correct import file. Do not return JSON until the ambiguities are resolved.

### Quiz topic and preferences

Overall quiz topic: {{QUIZ_TOPIC}}

Use this topic as the subject for the pool name and for the inferred question categories. The categories must be written into each question's `topic` field so the portal can display them when this pool is selected for a test.

Quiz name: [optional; use a suitable name if blank]
Number of questions per attempt: [optional; default 25]
Time limit in minutes: [optional; default 15]

### My source question pool

[Paste the questions here or attach the source file]

---

The generated JSON includes answer keys because the current candidate app grades quizzes in the browser. Treat imported files as confidential and only upload pools approved for the assessment.
