This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Secrets

Local development uses `.env.local`, which is gitignored and must never be committed. Copy `.env.example` to `.env.local` and fill in real values.

**Production secrets live only in the Vercel dashboard** — never in the repo, never in `.env.local` on another machine. Rotate a key in Vercel → Settings → Environment Variables and redeploy.

A pre-commit hook at `.githooks/pre-commit` scans staged changes for patterns like `sk_live_`, `whsec_`, `-----BEGIN PRIVATE KEY-----`, and will abort the commit if any are found. The hook is wired up automatically by `pnpm install` (via the `prepare` script). If you ever need to bypass it, fix the underlying leak instead — a real secret committed to git must be rotated, not force-pushed away.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
