import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const MAX_FILE_LINES = 450;
const MAX_FUNCTION_LINES = 30;
const MAX_PARAMS = 4;

export default defineConfig(
  { ignores: ["dist/", "coverage/", "node_modules/", "scripts/**/*.mjs", "test/fixtures/", "test/support/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.js"] }, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "max-lines": ["error", { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", MAX_PARAMS],
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"] }],
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true } }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    files: ["vitest.config.ts", "eslint.config.js"],
    rules: { "no-restricted-exports": "off" },
  },
);
