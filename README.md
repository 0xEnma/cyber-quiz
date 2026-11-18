## Local preview

Run `npm run preview` and open http://127.0.0.1:4173. The local preview PIN defaults to `1234` (override it with `ADMIN_PIN` in `.env.local`). Preview data is held in memory and resets when the preview server stops.

# BankShield assessment

## Create a question pool and tests

1. Open the administrator portal at /admin.html. Enter the quiz topic and click Copy prepared AI prompt. Paste it into an AI chat along with your source questions. The AI will create the requested number of questions, assign categories automatically, and return portal-ready JSON; save the raw response as a .json file.
2. Upload the file in Question pools. The portal validates question types and required fields before storing it.
3. In Generate test links, select a pool, set the question count and time limit, then create a link. You can create multiple links for the same pool. Use Copy test link to share a link with candidates.
4. Candidates open their test link and enter their candidate details. The link loads the assigned quiz; no access code is shown or entered on the candidate page.
5. Results include the question pool alias under Test Category.

Uploaded question pools, test links, and submissions use private Vercel Blob storage. The admin dashboard lets you change the administrator PIN. On the hosted app, the new PIN is stored as a private hash in Vercel Blob; the local preview keeps it in memory and resets to its configured PIN when it stops. The local preview also keeps pools, test links, and submissions in memory.

The candidate app currently grades in the browser, so pool answer keys are delivered to the browser as they are for the built-in pool. Use fictional training examples and treat pool files as confidential.
