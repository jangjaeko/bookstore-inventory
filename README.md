# Bookstore Inventory

A web app for tracking book stock at a Korean bookstore in Canada. Paste rows out of a
spreadsheet and they become inventory; paste a library invoice and the same books come
back out. Stock lives in Postgres so every machine in the shop sees the same numbers.

Deployed on Vercel behind a shared password. The URL is not published here because the
instance holds a real shop's stock — happy to give it out on request.

> Sibling project: [todays-books-helper](https://github.com/jangjaeko/todays-books-helper) —
> a Chrome extension that pulls book data off YES24 and copies it in these same column
> layouts. Separate repository, separate deploy, **shared column order**.

## Why this exists

The shop buys Korean books, ships them to Canada, and sells them — a good share to public
library systems, which order by invoice. Stock was tracked in spreadsheets, which broke
down in three ways:

- **Nobody agreed on the current number.** Files lived on different machines and diverged.
- **Every document has a different shape.** The shipping manifest, the SALES list, and each
  library's invoice (BPL, LBI) all carry the same books in different column orders — some
  with romanised and Korean columns side by side, one with a single book split across two
  rows.
- **Sales never made it back.** Books left the shelf on an invoice but the count stayed put,
  so the sheet drifted further from reality every month.

This app keeps one authoritative count, accepts every one of those document shapes as
paste-in, and handles both directions — purchases add, invoices subtract.

## What it does

### Paste from any of the spreadsheets

Copy rows out of Excel, paste, done. The app figures out which column is which, shows you
a preview, and only writes when you confirm.

- **Built-in layouts** for shipping manifests (three variants), SALES, BPL invoices (two
  variants), and LBI invoices. Anything else: map the columns by hand once and save it
  under a name.
- **Junk rows drop out by themselves.** Section headings (`Teen FIC`, `MYS`), budget blocks,
  `Subtotal` / `GST` / `Total Amount Due`, and blank rows all lack a title, which is the
  test. Paste the whole sheet; no pre-cleaning.
- **Two-row books** (LBI) are stitched back together, Korean title winning over romanised.
- **Cells containing line breaks** survive. Excel wraps those in quotes and keeps the
  newline; a quote-aware tokenizer reads it as one cell instead of splitting the book in two.

Every row in the preview is labelled with what will happen to it — registered, updated,
merged into the row above, or dropped and why.

### In and out

Purchase documents raise stock; invoices lower it. Before an outbound run lands you are
told which books **aren't in stock at all** (usually a missed purchase entry) and which
ones **would go negative**. Nothing goes below zero.

### No duplicate entries

Books are identified by ISBN — hyphens, stray spaces, Excel's quote wrapping, and trailing
notes like `9788979197686/절판` all resolve to the same book. Without an ISBN it falls back
to title + author. Re-pasting a file adds quantities to the existing rows rather than
creating a second copy of everything.

### Day-to-day

- **Adjust counts** with ＋/− or by typing a number. Saves immediately; concurrent clicks
  are handled atomically so rapid tapping never loses a click.
- **Bulk actions** — select rows, then take stock in or out in one go, or copy them back
  out in shipping / SALES / LBI layout.
- **Search** across title, ISBN, author, publisher, subject, memo, and shelf location.
  Whitespace-insensitive, so `우리아기` finds `우리 아기 알록달록 색깔 촉감책`. Partial
  ISBNs work, with or without hyphens. `Ctrl+K` jumps to the box.
- **Filter by subject.** `KOR FIC > GEN SS` collapses to `KOR FIC`, and the dropdown lists
  each group with a count.
- **Low stock / out of stock** highlighting, threshold configurable (default 0 = flag only
  zero).
- **Full movement history** per book: when, how many, which direction, and why.
- **Export** to CSV, or copy selected rows in any of the spreadsheet layouts.

## Getting set up

### 1. Create the database

Make a project at [console.neon.tech](https://console.neon.tech) and copy the connection
string. The free tier is plenty — see [Capacity](#capacity) below.

### 2. Environment variables

```bash
cp .env.example .env.local
```

| Name | What it is |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `APP_PASSWORD` | Shared password for the app — this is what staff type |
| `AUTH_SECRET` | Random string used to sign the session cookie |

Generate `AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Create the tables

```bash
npm install
npm run db:push
```

### 4. Run it

```bash
npm run dev          # http://localhost:3000
```

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. Import it at [vercel.com/new](https://vercel.com/new). **Skip the optional
   integrations** — connecting Neon there provisions a *second*, empty database and
   overwrites `DATABASE_URL`.
3. Under **Settings → Environment Variables**, add all three values from `.env.local`.
4. Deploy. Tables already exist from step 3, so there is nothing else to run.
5. Under **Settings → Deployment Protection**, turn **Vercel Authentication** off —
   otherwise only the Vercel account owner can reach the site, and the app's own password
   screen already guards it.

After that, `git push` redeploys automatically.

Changing `APP_PASSWORD` later means editing it in Vercel **and redeploying**; environment
variables are baked in at build time. Everyone gets logged out, because the session cookie
is signed with the password. Leave `AUTH_SECRET` alone unless you want that on purpose.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Parser tests, using real spreadsheet and invoice data |
| `npm run db:push` | Apply the schema to the database |
| `npm run db:generate` | Generate a SQL migration from schema changes |
| `npm run db:studio` | Browse the database |

## Layout

```
app/
├── page.tsx                inventory screen (just mounts InventoryApp)
├── login/page.tsx          password screen
├── components/
│   ├── InventoryApp.tsx    list · search · filters · quantity · bulk actions
│   ├── ImportDialog.tsx    paste → column mapping → preview → apply
│   ├── EditDialog.tsx      add / edit one book
│   ├── LogDialog.tsx       movement history
│   └── ui.tsx              button · modal · field
└── api/
    ├── books/              list, search, add, bulk (+ [id] edit/delete, /match, /[id]/logs)
    ├── import/             bulk apply (UPSERT in, decrement out)
    ├── presets/            user-saved column mappings
    └── login, logout

lib/
├── schema.ts               books / stock_logs / import_presets
├── db.ts                   Drizzle + Neon (lazily initialised)
├── parse.ts                tokenizer · column detection · book identity   ← the core
├── format.ts               spreadsheet layouts, CSV, subject grouping
├── auth.ts                 shared password + HMAC cookie
└── api.ts                  shared route helpers

middleware.ts               redirects to /login (APIs answer 401)
tests/                      parser tests against real data
```

---

## How it works

### Book identity (`matchKey`)

`books.match_key` is UNIQUE and every import is an UPSERT against it.

- With an ISBN → `i:9791130681887` (digits only; hyphens, spaces, and trailing notes ignored)
- Without one → `t:title|author` (whitespace stripped, lowercased)

So `979-11-3068-188-7`, `"    9791130681887"`, and `9788979197686/절판` all land on the
right book. The original text is kept as typed; only matching is normalised.

When the ISBN column holds something like `판매용` instead of a number, the string is
preserved but identity falls back to title + author.

### Built-in layouts

| Layout | Cols | Direction | Notes |
|---|---|---|---|
| Auto-detect | — | in | Works out the columns itself. Start here if unsure |
| Shipping · from TOTAL | 16 | in | Column A is `TOTAL` (the VPL order sheet) |
| Shipping · from ISBN, with reviews | 16 | in | **What the Chrome extension copies today** |
| Shipping · from ISBN | 15 | in | For files exported before the review column existed |
| SALES | 8 | in | Extension's Case 1 |
| BPL invoice · 12 col | 12 | **out** | Korean columns only |
| BPL invoice · 17 col | 17 | **out** | Romanised and Korean columns paired |
| LBI invoice | 10 | **out** | One book spans **two rows** |

**Two layouts are 16 columns wide — read the names.** `from TOTAL` starts with quantity,
`from ISBN, with reviews` starts with ISBN. Pick the wrong one and every value shifts by a
column. A width mismatch triggers an orange warning, but these two have the same width, so
glance at the preview's column headers.

### Quantity comes from `TOTAL`, not `Copies`

Shipping sheets have up to three columns that look like a quantity:

| Column | What it is |
|---|---|
| **`TOTAL`** | **The real stock count. This is the only one used.** |
| `Copies` (7th) | Padding kept so the row can be pasted into library order forms later |
| `Copies` (14th) | Same |

They disagree on purpose — `바깥은 여름` is TOTAL 2 / Copies 3 and imports as **2**. Empty
`Copies` cells are fine. Locked down in `tests/vpl.test.mjs` so it does not get "fixed".

### The review column is read and discarded

The extension appends a member-review count to the shipping layout. It is useful when
deciding whether to buy a title, and useless afterwards, so it is not stored — hence the
empty 16th slot in the `shipping16r` mapping.

### Updating existing books

Picked from **`Update with new values`** in the paste dialog. In every mode only non-empty
incoming values overwrite, so blank invoice cells never erase what you have.

| Choice | Overwrites |
|---|---|
| **Everything** | title, author, publisher + price, subject, pub date, weight |
| **Price / subject / date only** | price (CAD + KRW), subject, pub date, weight. **Title, author, publisher untouched** |
| **Nothing** | quantity only |

Inbound defaults to *everything*; outbound defaults to *price / subject / date only*.
Invoice title columns sometimes carry romanised text or notes like
`Qty. increased upon request`, so outbound refreshes the numbers and the subject — which
are more accurate on the invoice than on the purchase sheet — while leaving the Korean
bibliographic data alone.

### Subject grouping

Subjects are multi-level; the filter uses the first segment.

| Raw value | Group |
|---|---|
| `KOR FIC > GEN SS` | `KOR FIC` |
| `FIC - GEN SS` | `FIC` (spaced hyphen also separates) |
| `Self-Help > Success` | `Self-Help` (tight hyphen is part of the word) |
| `KOR Essays` | `KOR Essays` (no separator → whole string) |
| `KOR > Learning English > Writing` | `KOR > Learning English` |
| `국내도서 > 어린이 > 1-2학년 > …` | `국내도서 > 어린이` |

The last two are the exception: `KOR` and `국내도서` sit on more than half the catalogue, so
grouping by them filters nothing — those go one level deeper (`BROAD_ROOTS` in
`lib/format.ts`).

Filtering compares **including the separator**, so `FIC` does not sweep in `FICTION` or
`KOR FIC`.

### BPL invoices (outbound)

Library delivery invoices are books that left the shelf, so they go in as outbound. Two
shapes exist:

**12 columns** — Korean only:
```
ISBN │ Title. Kor │ Unit Price │ 15% Discount │ Net Price │ Copies │ Amount │
Author. Kor │ Pub. Date │ Pub. City │ Publisher │ Subject
```

**17 columns** — romanised and Korean paired:
```
ISBN │ Title │ Title. Kor │ Other Title │ Unit Price │ 15% Discount │ Net Price │
Author │ Author. Kor │ Pub.City │ Pub.City. Kor │ Publisher │ Publisher. Kor │
Pub. Date │ Subject │ Copies │ Amount
```

Both map the **Korean** columns, because stock is held in Korean (sourced from YES24) and
that is what has to match. `Pub. City` is deliberately unmapped — see the next section for
why it is dangerous.

Rows with `Copies 0` (ordered but not shipped) change nothing.

### LBI invoices (outbound, two rows per book)

```
NO │ ISBN │ Title │ Unit Price │ 15% Discount │ Net Price │ Copies │ Amount │ Author │ Pub. Date
 1 │ 9791168343641 │ Bulgeun kal │ $41.50 │ ($6.23) │ $35.27 │ 1 │ $35.27 │ Jeong, Bora │ 202603
   │               │ 붉은 칼 (개정판) │ … │ … │ … │ … │ … │ 정보라 │
```

ISBN, romanised title, and money are on the first row; **Korean title and author on the
second**. The `Two rows per book` option (automatic with the LBI layout) merges them, with
the lower row winning — so the Korean title survives. Merged rows show with a blue
background in the preview.

**Without that option one book becomes two.** The second row has no ISBN, so it identifies
by title + author, matches nothing in stock, and floods the preview with "not in stock".
That is the symptom to watch for.

A row is treated as a continuation only when it **has no ISBN, has a title, and follows an
open book**. Requiring a title is what keeps budget and total rows (`19C`, `($643.39)`,
`Budget Left`) from being absorbed into the book above them.

### Column auto-detection

Each column is scored on what its values look like. Two decisions are less obvious than
they sound:

**Median, not mean.** A single `Subtotal 414` row at the bottom of an invoice drags the
average enough to make a quantity column look like a weight column. The median ignores it.

**Title = length × uniqueness².** Length alone is not enough: `경기도, 파주시` in a
publication-city column is longer than most Korean book titles, so it wins the title slot
and pushes the real title into publisher. Titles are nearly all distinct (≈1.0) while
cities repeat (≈0.07), so weighting uniqueness separates them even when titles are two or
three characters long.

Text columns containing Hangul are preferred when both romanised and Korean columns exist.

### Paste with tabs

Copying from Excel gives tab-separated text, which preserves empty columns exactly. Going
through a chat window or notepad converts tabs to spaces and **empty columns disappear** —
then you have to fix the mapping by hand.

Cell-internal line breaks are fine: Excel quotes those cells and keeps the newline, and
`splitRows()` uses a quote-aware tokenizer rather than splitting on `\n`. Inside quotes,
newlines and delimiters are literal text; `""` unescapes to one quote. Cell values get
internal whitespace collapsed to single spaces.

### Outbound is not reversible

Pasting the same invoice twice subtracts twice. Inbound is an ISBN-keyed UPSERT so it
cannot duplicate, but outbound does not yet remember which invoices it has already seen.
Check the preview counts before applying; if it goes wrong, use the history screen to work
out what to put back.

## Capacity

Measured with 50,000 rows of realistic Korean bibliographic data:

| | |
|---|---|
| One book | ~86 bytes including indexes |
| One movement record | ~100 bytes |
| Neon free tier (0.5 GB) | roughly **6 million books** |
| 20,000 books + 200,000 movements | 38 MB — 7.5% of the free tier |

Storage is not the constraint. **Compute is**: the free tier allows 100 CU-hours per month,
and the database sleeps after five minutes idle. A few staff using it on and off through
the day lands well inside that. Exceeding any free limit suspends the database until the
next billing month, so keep an eye on the Neon dashboard and move to the paid tier if usage
climbs.

Don't put cover images in Postgres. Use object storage and keep a URL.

## License

MIT
