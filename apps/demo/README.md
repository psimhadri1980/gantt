# Demo

Every sample and option of the Gantt on one page.

```bash
npm run dev
```

Opens at http://127.0.0.1:5180. The toolbar picks the sample (`?sample=` in the URL), theme, language
(`?lang=de`, or `ar` for the right-to-left layout), details-panel position and options such as read-only mode,
failing saves and host templates. The `proposals` sample runs the review workflow with several users and a clock
that can be moved forward to test deadlines.

`bench.html` is the 10,000-task benchmark page that `npm run bench` drives; the end-to-end tests
(`npm run e2e`) run against a production build of this app.
