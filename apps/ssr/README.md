# Server rendering example

The Gantt rendered on the server with `react-dom/server` and hydrated in the browser.

```bash
pnpm --filter @gantt/ssr-example start
```

Opens at http://127.0.0.1:5185.

The `ssr` prop is what makes this work: the Gantt places the roadmap synchronously during render, so the server
HTML already contains the rows and bars, and the browser's first render produces the same markup (no hydration
mismatch, no layout jump). Anything else that could differ between server and browser must be fixed too; here
`today` is passed explicitly. The stylesheet is inlined in the page head so the HTML is laid out before scripts run.

In Next.js, render `<Gantt ssr … />` from a client component (`'use client'`) and import `gantt.css` globally.

The end-to-end suite checks this app: the HTML holds the chart without JavaScript, hydration reports no
mismatch and no errors, and bar positions are identical before and after hydration.
