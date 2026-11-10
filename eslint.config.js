// ESLint flat config. no-unsanitized blocks innerHTML/outerHTML/insertAdjacentHTML/document.write
// with unsanitized data (SEC-DOM-2); no-eval and no-implied-eval back up SEC-EVAL-1.
import js from "@eslint/js";
import nounsanitized from "eslint-plugin-no-unsanitized";

export default [
  { ignores: ["vendor/**", "node_modules/**", "dist/**"] },
  js.configs.recommended,
  nounsanitized.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { window: "readonly", document: "readonly", console: "readonly", chrome: "readonly", URL: "readonly", setTimeout: "readonly" } },
    rules: { "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error" },
  },
  {
    // Pure modules also run in a Web Worker.
    files: ["js/**"],
    languageOptions: { globals: { TextDecoder: "readonly", self: "readonly", DOMException: "readonly", fetch: "readonly", AbortController: "readonly", Blob: "readonly", Node: "readonly", navigator: "readonly", getComputedStyle: "readonly", Worker: "readonly", requestAnimationFrame: "readonly", clearTimeout: "readonly", location: "readonly", MutationObserver: "readonly", HTMLElement: "readonly", CSS: "readonly" } },
  },
  {
    files: ["**/*.test.*", "tests/**", "test/**", "scripts/**"],
    languageOptions: { globals: { process: "readonly", URL: "readonly", TextDecoder: "readonly", TextEncoder: "readonly", performance: "readonly", AbortController: "readonly", DOMException: "readonly", structuredClone: "readonly" } },
  },
];
