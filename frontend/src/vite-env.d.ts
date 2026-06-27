/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'mammoth/mammoth.browser' {
  export interface ExtractResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<ExtractResult>;
  const _default: { extractRawText: typeof extractRawText };
  export default _default;
}
