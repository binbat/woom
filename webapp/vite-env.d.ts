/// <reference types="vite/client" />

// https://github.com/pmndrs/jotai/pull/605
interface SymbolConstructor {
  readonly observable: symbol
}
