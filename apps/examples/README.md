# State-management examples

The Gantt is a controlled component: the host keeps the roadmap, passes it as `data`, and stores each new
version reported by `onDataChanged`. `src/state.tsx` shows three ways to hold it:

1. **Local state** (`useState`): one screen owns the roadmap.
2. **A reducer** (`useReducer`): the Gantt's change is one action among others. The reducer works unchanged
   as a Redux Toolkit slice.
3. **An external store** read with `useSyncExternalStore`: the shape of Zustand and Redux stores, so either can
   replace the small `createStore`.

`src/state.test.tsx` checks each one both ways: an edit in the Gantt reaches the state, and a change made to the
state shows in the Gantt.
