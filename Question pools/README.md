# Question pool files

Keep question-bank JSON files in this folder. It contains the BankShield standard pool and the Cyber Hygiene pool.

The local preview loads these JSON files and saves pool uploads and edits here. The folder is excluded from Vercel deployments so question data and answer keys are not served as static files. On Vercel, the built-in pool stays in server-side API code, while pools uploaded or edited through the admin portal are stored in private Vercel Blob storage.
