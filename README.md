## Local preview

Set `ADMIN_PIN` (4-12 digits) and `ADMIN_SESSION_SECRET` in `.env.local`, then run `npm run preview` and open http://127.0.0.1:4173. The preview binds to localhost and keeps data in memory; tests, pools, submissions and a changed PIN reset when it stops.

# BankShield assessment

## Create a question pool and tests

1. Open the administrator portal at /admin.html. Enter the quiz topic and pool question count, then click Copy prepared AI prompt. Paste it into an AI chat along with your source questions. The AI will create the requested number of questions, assign categories automatically, and return portal-ready JSON; save the raw response as a .json file.
2. Upload the file in Question pools. The portal validates question types and required fields before storing it.
3. Set the question count and time limit in Test Access for each link. Each link stores its own values, which control that candidate attempt. You can create multiple links for the same pool. Use Copy test link to share a link with candidates.
4. Candidates open their test link and enter their candidate details. The link loads the assigned quiz; no access code is shown or entered on the candidate page.
5. Results include the question pool alias under Test Category.

Uploaded question pools, test links, and submissions use private Vercel Blob storage. The admin dashboard lets you change the administrator PIN. On the hosted app, the new PIN is stored as a private hash in Vercel Blob; the local preview keeps it in memory and resets to its configured PIN when it stops. The local preview also keeps pools, test links, and submissions in memory.

Candidates receive questions without answer keys. The server grades submissions and stores the correct answers for administrator review. The assessment remains browser-based and is not a proctored testing system; use fictional training examples and treat pool files as confidential.

## Merge large question pools

AI chats may not reliably produce a very large pool (for example, 300 questions) in one reply. Generate the pool in several parts, then combine them with the dependency-free `merge-pools.mjs` script (Node.js 18 or newer). The script checks questions against the BankShield import format and writes one file to upload in the admin portal.

```sh
node merge-pools.mjs part1.json part2.json part3.json -o my-question-pool.json
```

| Option | Meaning |
|---|---|
| `-o, --out <file>` | Output file (default: `merged-question-pool.json`) |
| `--count <n>` | Questions per candidate attempt (default: from part 1) |
| `--time <minutes>` | Time limit in minutes (default: from part 1) |
| `--skip-invalid` | Drop invalid questions with a warning instead of stopping |
| `--keep-newlines` | Keep line breaks inside question text (default: join them with a space) |
| `-h, --help` | Show help |

Part 1 must contain the full pool object with `name`, `questionCount`, `timeLimitMinutes`, and `questions`. Later parts can be a bare question array or an object containing a `questions` array. The merged pool keeps its name and settings from part 1, preserves file order, and renumbers question IDs from 1 to N. Use `--count` or `--time` to override the attempt size or time limit.

The script reads only the files listed in the command, in the order given. Shells such as Bash expand wildcards; PowerShell and Command Prompt do not, so list each file explicitly there.

It validates required fields, question types, difficulty, answer indexes, and branching paths (starting at `s1`, with valid links, no cycles, and exactly three decisions on every path). It removes exact duplicate questions, unifies topic labels that differ only in capitalization or spacing, and reports common repairs such as JSON code fences, line breaks inside strings, trailing commas, or a missing closing bracket. By default, any invalid question stops the merge without writing an output file. Use `--skip-invalid` to continue without invalid questions. A cut-off question is reported as invalid.

After merging, the script reports counts by source file, type, difficulty, and topic. It warns if more than half of the single-choice answers use the same option position. The checks validate file structure, not the question content or answer correctness; review the merged pool before using it in an assessment.

Typical workflow: generate around 50 questions per part with the question-pool prompt, save each response as JSON (the first part is the full pool object), merge the parts, then upload the output under **Question pools** in the admin portal.
