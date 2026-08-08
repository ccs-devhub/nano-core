/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const COMPONENT: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default COMPONENT;
}
