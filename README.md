# Household Budget

A phone-first household budget app. Its main number is **how much is left to spend**, card or
cash, until the next card bill is due, with that bill and planned payments already set aside.
Under it is **the cash you can spend now** without the bank running short before a payment.

- Card-cycle aware: purchases from the cut-off day go on the next bill.
- Weekly paydays, planned payments, and card payments (including partial ones).
- A day-by-day "bank balance ahead" with warnings.
- Several people can log on their own phones. Everything syncs through your own Google Sheet
  ([setup guide](docs/sync-setup.md)).
- Plain HTML/CSS/JavaScript. No build step, no dependencies, no running costs.

How the numbers work: [docs/spec.md](docs/spec.md).

## Try it

```
node tools/serve.mjs
```

Then open:

- **Your own setup:** http://localhost:8080/budget-app/
- **Made-up demo household** (nothing is saved): http://localhost:8080/budget-app/?demo=1
- **Show any day:** add `&today=2026-10-15` to the address.

## Checks

```
npm test                         # unit tests, incl. made-up end-to-end money scenarios
node tools/e2e.mjs               # phone-size walkthrough in headless Chrome (+ layout and errors)
node tools/e2e-sync.mjs          # two browsers syncing through a local stand-in for Google's server
node tools/smoke.mjs             # quick render check of every tab
node tools/privacy-check.mjs     # nothing private in the files about to be committed
```

## Privacy

**This repository is public.** It must never contain real amounts, names, places, links or
secrets.

- **Your data** lives on your devices and in your own Google Sheet, never in this code.
- **Real-number tests** live in git-ignored files (`*.local.test.js`, `local/`).
- **Your usual places** come from a git-ignored places file (see `docs/places.example.json`),
  imported in Settings.
- **`tools/privacy-check.mjs`** blocks private strings listed in a file that sits outside the repo.
