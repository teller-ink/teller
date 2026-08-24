// The rung-4 import map's 'react' target (§E UN-DEFERRED). Panel code
// imports 'react' as a bare specifier, resolved by client/index.html's
// <script type="importmap"> to this module.
//
// This file is an EXTRA ENTRY POINT in the SAME rollup build as the app
// itself (vite.client.config.ts adds it to build.rollupOptions.input
// alongside `main`) — not a separate bundle. Because both entries import
// the same 'react' module in one graph, Rollup factors it into a shared
// chunk both entries reference; re-exporting here (never re-bundling
// react on its own) is what keeps it to ONE React instance at runtime. A
// second, independently-bundled copy of react is exactly the failure
// mode this guards against (a panel's hooks would run against a
// different dispatcher than the app's, which throws "Invalid hook
// call").
//
// `@types/react`'s `index.d.ts` types the package with `export =`
// (a CJS-style namespace), which `export * from 'react'` can't spread —
// so this re-exports by NAME instead, one line per member the runtime
// object actually carries (`Object.keys(require('react'))`, react
// 19.2). Anything panel code needs that's missing here is a one-line
// add, never a reason to fall back to `export *`.
import React, {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from 'react';

export default React;
export {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
};
