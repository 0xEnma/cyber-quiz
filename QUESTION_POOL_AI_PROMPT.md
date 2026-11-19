You are an expert designer of security-awareness assessments. Generate a complete BankShield quiz import file from the topic and question count below. Your entire response must be one JSON document (see "Output rules").

## Inputs
Topic: [TOPIC]
Number of questions in the pool: [NUMBER_OF_QUESTIONS]
Audience (optional): [leave blank for "bank employees"]
Quiz name (optional): [leave blank to choose a clear name]
Questions per candidate attempt (optional): [leave blank for the pool size, capped at 25]
Time limit in minutes (optional): [leave blank for 1 minute per attempt question, minimum 5]

If the topic is empty, or the number of questions is below 5, ask one short question and stop. Otherwise do not ask questions; make sensible assumptions and generate the file.

## Content rules
1. Write exactly the requested number of NEW questions on the topic. Write them from established good practice. Do not invent laws, statistics, regulator rules or bank-specific policies. Where a correct action depends on internal policy, say "per bank policy" in the question or explanation. Use region-neutral wording unless the topic names a region.
2. Use only fictional examples (for instance examplebank.com, "Mr Sharma", placeholder phone numbers). Never include real customer, employee, account or confidential data.
3. Every question must have a defensible, unambiguous correct answer. Distractors must be plausible, not silly. Do not use "all of the above" or "none of the above". Do not make the correct option the longest one. Spread correct answers across different option positions.
4. Aim for these mixes, rounded sensibly:
   - Types: single 28%, multi 16%, match 12%, order 12%, diff 12%, tabletop 12%, branch 8%. If the pool has 14 or more questions, include every type at least once. For smaller pools, favour single, multi, match, order and tabletop.
   - Difficulty: Basic 35%, Intermediate 45%, Advanced 20%.
   - Mix knowledge, scenario and "what would you do" questions. Mention a real-world context (customer at the counter, a call, an email, a shared device) where it fits the topic.
5. Automatically infer concise subject categories from the topic (roughly 3 to 10 when the pool size supports it; fewer for very small pools). Use short labels of 1 to 3 words, consistent across the pool. Put the label in each question's `topic` field. Do not invent unrelated categories.
6. `explanation` must briefly teach why the correct response is right (1 to 2 sentences). Keep the tone professional and blame-free.

## BankShield JSON format
Return one JSON object with exactly these root properties and no others:

{
  "name": "A clear name for this quiz",
  "questionCount": 25,
  "timeLimitMinutes": 25,
  "questions": []
}

- `questionCount`: how many questions each candidate receives. It must be between 5 and 93 and no greater than the number of questions in the pool.
- `timeLimitMinutes`: an integer from 1 to 180.

Every question must include: `id` (unique integer, 1 to N in order), `topic`, `type`, `prompt`, `explanation`, `difficulty` (exactly "Basic", "Intermediate" or "Advanced") and `formatLabel` (a short label such as "Single choice", "Multiple choice", "Matching", "Ordering", "Compare evidence", "Safe actions", "Branching scenario").

`type` must be one of: single, multi, match, order, diff, tabletop, branch. All answer indexes are zero-based (0 = first item). Use these type-specific fields and no others:

- single: `options` (array of 4 strings) and `answer` (one integer index).
- multi: `options` (4 to 6 strings) and `answer` (array of 2 to 4 distinct indexes). End the prompt with "(Select all that apply)".
- match: `left` and `right` (arrays of 4 to 6 strings, equal length) and `answer` (array with one right-side index for each left item, in left order). Every left item has a different correct right item. The `right` array must NOT be in the same order as the correct pairing.
- order: `options` (4 to 6 steps) and `answer` (every option index exactly once, in the correct sequence). The `options` must be shuffled, not already in the correct order.
- diff: `evidence` is an object with `a` and `b`, each an object of 1 to 4 labeled string values (for example {"From": "...", "Subject": "...", "Message": "..."} or {"URL": "..."}); `options` (4 to 6 findings) and `answer` (array of the correct finding indexes; use a single index when the question asks which item is genuine or suspicious). The prompt must say exactly what to find (for example "Select all red flags that appear in Evidence B but not in Evidence A."). The two pieces of evidence must differ in ways a careful employee could spot.
- tabletop: the prompt describes a scenario and ends with "Select all SAFE actions."; `options` (5 to 6 actions) and `answer` (array of 2 to 4 safe action indexes). Unsafe actions must be realistic temptations.
- branch: `nodes` array (see below). Do not add `options` or `answer` at the question level. The question-level `prompt` is a short title plus intro (for example "Branching scenario - <title>. Work through three decisions."), and the `explanation` states the key lesson.

### Branch structure (follow exactly)
Each node is {"id": "...", "prompt": "...", "options": [{"text": "...", "next": "..."}, ...], "answer": <index of the best option>}. Use exactly these five nodes with this wiring, so that every path has exactly three decisions followed by END:

- s1 (3 options): the best option has next "s2"; every other option has next "s2b".
- s2 (2 options): the best option has next "s3"; the other has next "s3b".
- s2b (2 options): both options have next "s3b". Its prompt describes the consequence of the earlier poor choice, and its best option is the sensible recovery action.
- s3 (2 to 3 options): every option has next "END". This is the final decision on the good path (for example follow-up, documentation or prevention).
- s3b (2 to 3 options): every option has next "END". This is the final decision on the recovery path (for example honest reporting or lessons learned).

Node prompts continue one coherent story, set in a realistic workplace moment, and each ends with a question such as "What do you do?". Vary which option index is best across nodes.

## Self-check before responding
Verify silently, fix any problem, then respond:
- The `questions` array has exactly [NUMBER_OF_QUESTIONS] items; ids are unique integers; questionCount is valid.
- Every required field is present; no extra fields; no extra root properties.
- Every index is a valid zero-based index; match arrays are the same length; order answers use every index once.
- Correct answers are spread across positions and there is no pattern (such as always index 1).
- Every branch has exactly the five nodes above, valid `next` references, no cycles, and every path is three decisions then END.
- The JSON is syntactically valid: double quotes, no trailing commas, no comments, no line breaks inside strings.

## Output rules
- Return ONLY the JSON object: no Markdown code fences, no introduction, no notes. It must parse with JSON.parse and be ready to save as my-question-pool.json and upload.
- If you cannot fit all questions into one response, do not output partial JSON. Reply only with one plain sentence stating the largest number of questions you can produce in a single response.
