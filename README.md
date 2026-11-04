# BookNook Server

Express + MongoDB API for BookNook.

- 8 routes: `GET/POST /books`, `GET/PATCH/DELETE /books/:id`, `POST/GET /borrows`, `DELETE /borrows/:id`
- JWT verification (BetterAuth tokens checked against the client's JWKS)
- Atomic copy counting with `$inc`, unique index blocks double borrowing
- Owner-only edit and delete

Setup: copy `.env.example` to `.env`, run `npm i && npm run dev`. Deploy to Vercel (`vercel.json` included) and set the same env vars.
