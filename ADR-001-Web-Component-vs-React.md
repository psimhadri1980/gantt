# ADR-001: Build the Gantt as a native React component, not a Web Component

- Status: Accepted (2026-11-11). Replaces the same-day draft of this record, which had accepted the Web Component conditionally.
- Date: 2026-11-11
- Applies to: `Gantt-Feature-Plan.md`, section 0a and decisions 22 and 23

## 1. Context

The Gantt must be extraordinary, flexible and user-intuitive. Two ways to build it were compared:

- **A. Native React component.** One implementation, React only.
- **B. Web Component built with Lit**, with generated wrappers for React, Vue and Angular.

Option B was first chosen so that one implementation could serve three frameworks. The research below showed that it is worth its cost only if Vue or Angular applications will really use the Gantt. The deciding fact, confirmed on 2026-11-11: **the only consumers are React applications.**

## 2. Decision

Build option A: a native React component.

Keep one thing from option B: all logic lives in framework-free packages (scheduling engine, access evaluator, data contract, Proposal logic, and the chart's state and layout calculations). The React package does rendering and interaction on top of them.

That split is needed anyway, because the server runs the same engine and access evaluator. It also keeps the door open: if a Vue or Angular consumer appears later, a second rendering layer or a Web Component can be built over the same packages without touching the engine, Proposals or access control.

## 3. Evidence

Gathered by web search on 2026-11-11. Most performance claims come from vendors about their own products; none was independently verified, and the articles were read through search summaries, not in full.

### What favoured the Web Component

| Finding | What it means here |
|---|---|
| The established commercial Gantt products (Bryntum, DHTMLX) are one framework-free core with a wrapper per framework. | One core with wrappers is the normal way to ship a Gantt to several frameworks. |
| DHTMLX launched separate "pure React, Svelte and Vue" Gantt libraries in 2021 and withdrew them; its page was updated in February 2026 to say they are no longer available, and its documentation now points to wrappers. The reason is not stated. | Keeping a native implementation per framework did not last even for a vendor whose only business is this. |
| React 19 sets properties and listens to custom events on custom elements, and is reported to pass the Custom Elements Everywhere tests. | The old React obstacle is gone for React 19. React 18 still needs the wrapper. |
| A Gantt draws most of its surface itself (bars, lines, time axis, virtualised rows) and handles dragging imperatively. | A framework's rendering model adds little inside the chart, so little is lost by not using React there. |
| Adobe recommends its Web Component wrappers over its React library for add-on developers, because the Web Component set is more complete. | A large vendor treats wrappers over Web Components as fit for production React use. |

### What counted against the Web Component

| Finding | What it means here |
|---|---|
| AG Grid replaced its React wrapper (which used portals for custom cells) with a rendering layer written in React, default since version 27. Its reasons: components sit directly in the React tree with no wrapper element, and React developer tools work. It kept one shared core for the logic. | The best-resourced vendor in this field found the wrapper approach not good enough for React at the cell level. It also shows the way out: shared core, replaceable rendering layer. |
| SVAR sells its React Gantt as "native, not a wrapper" and publishes a benchmark in which it beats wrapper-based products on loading, edits and live updates. | Vendor benchmark, so weak evidence, but "native" is a selling point React buyers respond to. |
| Lit's server-side rendering package is still a Labs package, described by its own readme as pre-release, with hydration and data handling out of scope. | A real server-rendered chart cannot be promised. Only a placeholder can. |
| Mercari moved its design system from Web Components to React, citing server-side rendering and labels that could not be associated across the shadow boundary. Deutsche Bahn's design system decided against shadow DOM because it limits developers. | The known pain points are server rendering, accessibility across shadow boundaries, and styling freedom. |
| Linking ARIA attributes across a shadow boundary needs Reference Target, which shipped in Chrome and Edge 152 (August 2026). Safari had it behind a flag in December 2025. No Firefox release was found. | It cannot be relied on yet. Relationships that screen readers need must stay inside one shadow root. |
| Wrapper generators from a Custom Elements Manifest are mature for React. Those for Angular and Vue are small community projects, and the broadest one lists parts of its Angular and Vue support as not yet available. | "Automatically generated" will partly mean a generator we maintain ourselves. |
| No widely used Gantt built as a Lit element was found; the ones that exist are small. | There is no proven example to copy. |

## 4. Comparison

| Criterion | A. Native React | B. Lit Web Component |
|---|---|---|
| Reach | React only | React, Vue, Angular, plain HTML |
| Cost of each extra framework | A second implementation | A generated wrapper plus a small bridge |
| Feel inside a React application | Best: context, developer tools, templates as ordinary components | Good for properties and events; templates go through a bridge; developer tools show one opaque element |
| Server-side rendering | Works with the framework | Placeholder only |
| Accessibility | Ordinary DOM, no boundary problems | Achievable, but the internal structure is constrained to one shadow root |
| Host styling | Ordinary CSS reaches everything | Only what is offered as a CSS variable or a named part |
| Style and script isolation from the host | None by default | Strong |
| Rendering speed of the chart itself | Depends on bypassing React for the hot paths | Not tied to a framework's update cycle |
| Speed of host-written cell templates | Fast | Slower when written as framework components |
| Lock-in | To React and its major versions | To web standards and Lit, a small library |
| Risk | Low: well-trodden | Medium: wrappers, templates and server rendering are less proven |

## 5. Why React wins here

With no Vue or Angular consumer, option B's one advantage (reach) is worth nothing, while its costs remain:

- a wrapper generator to maintain, three template bridges and three example applications in the test run;
- server-side rendering limited to a placeholder;
- an internal structure constrained by shadow DOM for accessibility;
- a less native feel for the only users there are: no React context inside the chart, nothing visible in React developer tools, templates through a bridge.

Option A gives React hosts templates as ordinary components, context, developer tools, real server rendering and ordinary CSS, on a well-trodden path.

## 6. Conditions and consequences

Conditions:
1. **Framework-free core.** Nothing in the engine, access, contract, proposals or state packages imports React. This is checked in the build.
2. **React is bypassed on the hot paths.** Scrolling, zooming and dragging update positions directly and do not re-render the tree on every frame. The Phase 1 spike proves this against the performance budget.
3. **Styles are scoped by convention**, since there is no shadow DOM: prefixed class names and CSS variables, no global selectors, no dependence on host resets.

Consequences:
- Vue, Angular and plain-HTML hosts cannot use the Gantt without further work.
- The product follows React's major versions (18 and 19 supported).
- Less to build than option B: no generator, no bridges, one example application.

## 7. When to revisit

Revisit if a Vue, Angular or non-framework application commits to using the Gantt. The options then, in order of cost: wrap the React component as a custom element for that host; or build a second rendering layer over the shared core. The evidence in section 3 applies to that choice.

## 8. Sources

- AG Grid, React rendering engine: https://blog.ag-grid.com/react-ui-overview/ and https://blog.ag-grid.com/why-ag-grids-react-rendering-matters/
- AG Grid 27 release notes: https://blog.ag-grid.com/whats-new-in-ag-grid-27/
- DHTMLX, native React, Svelte and Vue Gantt libraries (withdrawn): https://dhtmlx.com/blog/brand-new-dhtmlx-gantt-libraries-pure-react-svelte/
- DHTMLX React integration: https://docs.dhtmlx.com/gantt/integrations/react/overview/
- Bryntum Gantt React examples: https://www.bryntum.com/examples/gantt-latest/examples/react/
- SVAR React Gantt: https://svar.dev/react/gantt/
- SVAR benchmark of native against wrapped components: https://dev.to/mkozhukh/why-react-components-beat-js-wrappers-in-performance-3die
- Lit server-side rendering: https://lit.dev/docs/ssr/overview/ and https://www.npmjs.com/package/@lit-labs/ssr
- Mercari, migrating Web Components to React: https://engineering.mercari.com/en/blog/entry/20221207-web-design-system-migrating-web-components-to-react/
- Deutsche Bahn design system, shadow DOM discussion: https://github.com/db-ux-design-system/core-web/issues/8807
- Reference Target in Chrome 152: https://developer.chrome.com/release-notes/152
- Reference Target explainer: https://github.com/WICG/webcomponents/blob/gh-pages/proposals/reference-target-explainer.md
- Reference Target, Safari status (December 2025): https://meyerweb.com/eric/thoughts/2025/12/19/targeting-by-reference-in-the-shadow-dom/
- Chrome guidance on accessible Web Components: https://developer.chrome.com/docs/modern-web-guidance/guides/html/accessible-web-components
- Custom Elements Everywhere: https://custom-elements-everywhere.com/
- Wrapper generators: https://github.com/wc-toolkit/react-wrappers , https://chialab.github.io/plasma/guide , https://github.com/lit-migrators/cem-angular-generator , https://github.com/break-stuff/cem-tools
- Adobe, Spectrum Web Components in React: https://developer.adobe.com/express/add-ons/docs/guides/learn/how_to/tutorials/spectrum-workshop/part2
