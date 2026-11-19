## Local preview

Set `ADMIN_PIN` (4-12 digits) and `ADMIN_SESSION_SECRET` in `.env.local`, then run `npm run preview` and open http://127.0.0.1:4173. The preview binds to localhost and keeps data in memory; tests, pools, submissions and a changed PIN reset when it stops.

# BankShield assessment

## Create a question pool and tests

1. Open the administrator portal at /admin.html. Enter the quiz topic and pool question count, then click Copy prepared AI prompt. Paste it into an AI chat along with your source questions. The AI will create the requested number of questions, assign categories automatically, and return portal-ready JSON; save the raw response as a .json file.
2. Upload the file in Question pools. The portal validates question types and required fields before storing it.
3. Standard pool defaults prefill settings for new tests. Each test link stores its own question count and time limit, which control that candidate attempt and can override the pool defaults. Then create the link. You can create multiple links for the same pool. Use Copy test link to share a link with candidates.
4. Candidates open their test link and enter their candidate details. The link loads the assigned quiz; no access code is shown or entered on the candidate page.
5. Results include the question pool alias under Test Category.

Uploaded question pools, test links, and submissions use private Vercel Blob storage. The admin dashboard lets you change the administrator PIN. On the hosted app, the new PIN is stored as a private hash in Vercel Blob; the local preview keeps it in memory and resets to its configured PIN when it stops. The local preview also keeps pools, test links, and submissions in memory.

Candidates receive questions without answer keys. The server grades submissions and stores the correct answers for administrator review. The assessment remains browser-based and is not a proctored testing system; use fictional training examples and treat pool files as confidential.
