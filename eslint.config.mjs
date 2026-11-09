import nextConfig from 'eslint-config-next';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import prettierPlugin from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import tailwindcss from 'eslint-plugin-tailwindcss';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import promise from 'eslint-plugin-promise';
import security from 'eslint-plugin-security';
import nPlugin from 'eslint-plugin-n';

const typeAwareLanguageOptions = {
  parser: tseslint.parser,
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: import.meta.dirname,
    noWarnOnMultipleProjects: true,
  },
};

const typeAwareRules = {
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',
  '@typescript-eslint/no-unsafe-enum-comparison': 'error',
  '@typescript-eslint/require-await': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
};

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'public/**',
      '.claude/**',
      'build/**',
      'coverage/**',
      // Playwright's generated HTML report ships minified vendor bundles. They
      // are gitignored, but flat config does not read .gitignore, so without
      // this lint walks into them and drowns in thousands of errors.
      'e2e/playwright-report/**',
      'e2e/test-results/**',
      '_archive/**',
      // AppleDouble sidecar files (this repo lives on an exFAT/HFS+ external
      // drive, which grows a `._foo.ts` next to `foo.ts` on every write) — junk,
      // never source.
      '**/._*',
    ],
  },
  ...nextConfig,
  ...coreWebVitals,
  eslintConfigPrettier,
  tailwindcss.configs.recommended,
  {
    plugins: {
      'import-x': importX,
      promise,
      tailwindcss: tailwindcss.configs.recommended.plugins.tailwindcss,
    },
    settings: {
      // v4 of the plugin reads the Tailwind entry point rather than a JS config,
      // and resolves @config from there.
      tailwindcss: {
        cssConfigPath: new URL('./app/globals.css', import.meta.url).pathname,
      },
      'import-x/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
        node: true,
      },
    },
    rules: {
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'promise/no-new-statics': 'error',
      'promise/no-return-wrap': 'error',
      'promise/valid-params': 'error',
      'promise/no-multiple-resolved': 'error',
    },
  },
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prettier/prettier': 'warn',
      // Whitelist project-specific class names the plugin can't resolve:
      //   @container/main — container-queries plugin syntax
      //   toaster — custom class consumed by sonner
      //   inputs — the rest parameter of cn(); the plugin reads the identifier,
      //            not a class, and there is nothing to rename here
      'tailwindcss/no-custom-classname': [
        'warn',
        {
          whitelist: ['@container/main', 'toaster', 'scrollbar-thin', 'inputs'],
        },
      ],
      // Tailwind 4's recommended plugin enables a large set of stylistic
      // rewrites. Keep contradiction detection enforced, but defer the
      // repository-wide formatting migration until it can be handled as a
      // dedicated CSS cleanup.
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      'tailwindcss/no-contradicting-classname': 'error',
      // @tanstack/react-table's hooks are not React-Compiler-compatible; the rule
      // fires on every useReactTable call and there is nothing actionable here.
      'react-hooks/incompatible-library': 'off',

      // Lifted from web.nurad.io — universally useful regardless of base config
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
      'react/jsx-wrap-multilines': ['error', { declaration: false, assignment: false }],
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-underscore-dangle': [
        'error',
        {
          allow: ['_id', '_ensureIndex', '_name'],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              importNames: ['toast'],
              message:
                "Use '@/app/lib/toast' helpers (showSuccessToast/showErrorToast) for standard messages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['components/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/img-redundant-alt': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Avoid inline styles in components. Prefer Tailwind classes or shared CSS utilities.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/max-(sm|md|lg|xl|2xl):/]",
          message:
            "Avoid Tailwind 'max-*' responsive variants. Keep styles mobile-first with base classes plus min-width breakpoints (sm/md/lg/xl/2xl).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] JSXExpressionContainer TemplateLiteral TemplateElement[value.raw=/max-(sm|md|lg|xl|2xl):/]",
          message:
            "Avoid Tailwind 'max-*' responsive variants. Keep styles mobile-first with base classes plus min-width breakpoints (sm/md/lg/xl/2xl).",
        },
      ],
    },
  },
  {
    // Endpoint governance: all UI/API client calls must go through the
    // centralized feature catalog (app/lib/features.ts), not raw '/api/*' strings.
    files: [
      'app/**/*.{ts,tsx,js,jsx}',
      'components/**/*.{ts,tsx,js,jsx}',
      'hooks/**/*.{ts,tsx,js,jsx}',
    ],
    ignores: ['app/api/**', 'app/lib/features.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='apiFetch'] > Literal:first-child[value=/^\\/api\\//]",
          message:
            "Do not call apiFetch with raw '/api/*' strings. Use endpointFor(AppFeature.*) from app/lib/features.",
        },
        {
          selector:
            "CallExpression[callee.name='apiFetch'] > TemplateLiteral:first-child TemplateElement[value.raw=/^\\/api\\//]",
          message:
            "Do not call apiFetch with raw '/api/*' template strings. Use endpointFor(AppFeature.*) helpers.",
        },
        {
          selector: "CallExpression[callee.name='fetch'] > Literal:first-child[value=/^\\/api\\//]",
          message:
            "Do not call fetch with raw '/api/*' strings. Use endpointFor(AppFeature.*) from app/lib/features.",
        },
        {
          selector:
            "CallExpression[callee.name='fetch'] > TemplateLiteral:first-child TemplateElement[value.raw=/^\\/api\\//]",
          message:
            "Do not call fetch with raw '/api/*' template strings. Use endpointFor(AppFeature.*) helpers.",
        },
      ],
    },
  },
  {
    files: ['components/ui/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-syntax': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
    },
  },
  {
    files: ['components/brand-palette-preview.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
  {
    // 12-factor guardrails for cloud-native app code:
    // - Avoid process control inside request/runtime modules.
    // - Avoid sync I/O in app runtime paths.
    // - Keep env access centralized and typed (progressive enforcement).
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      'no-process-exit': 'error',
      'no-sync': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:child_process', 'child_process'],
              message:
                'Do not spawn OS processes from app runtime modules. Use queue/services abstractions instead.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            "Prefer typed env access via '@/app/lib/env' to keep configuration explicit and validated.",
        },
      ],
    },
  },
  {
    files: [
      'app/api/**/*.{ts,tsx}',
      'app/lib/**/*.{ts,tsx}',
      'app/jobs/**/*.{ts,tsx}',
      'scripts/**/*.{ts,js,mjs}',
    ],
    plugins: {
      security,
    },
    rules: {
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'warn',
    },
  },
  {
    files: ['scripts/**/*.{ts,js,mjs}'],
    plugins: {
      n: nPlugin,
    },
    rules: {
      'n/no-deprecated-api': 'error',
      'n/no-new-require': 'error',
      'n/no-path-concat': 'error',
      'n/prefer-node-protocol': 'error',
    },
  },
  {
    // Allowed runtime boundaries for process management and direct env reads.
    files: [
      'app/lib/env.ts',
      'app/lib/logger.ts',
      'app/lib/connect-db.ts',
      'scripts/**/*.{ts,js,mjs}',
      'main.js',
    ],
    rules: {
      'no-process-exit': 'off',
      'no-sync': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      'security/detect-child-process': 'off',
    },
  },
  {
    // Temporary explicit exceptions:
    // - password-hashing uses sync bcrypt for deterministic auth-path behavior
    files: ['app/lib/password-hashing.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-sync': 'off',
      'security/detect-child-process': 'off',
    },
  },
  {
    // Keep server logic shallow and testable (favor guard clauses and extracted services).
    files: ['app/api/**/*.{ts,tsx}'],
    languageOptions: typeAwareLanguageOptions,
    plugins: {
      sonarjs,
    },
    rules: {
      'max-depth': ['error', 3],
      complexity: ['error', 12],
      'max-params': ['error', 5],
      'max-statements': ['error', 30],
      'no-else-return': ['error', { allowElseIf: false }],
      'max-lines-per-function': [
        'error',
        { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-nested-callbacks': ['error', 3],
      'sonarjs/cognitive-complexity': ['error', 8],
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/prefer-immediate-return': 'warn',
      ...typeAwareRules,
    },
  },
  {
    files: ['app/lib/services/**/*.{ts,tsx}', 'app/jobs/**/*.{ts,tsx}'],
    languageOptions: typeAwareLanguageOptions,
    plugins: {
      sonarjs,
    },
    rules: {
      'max-depth': ['error', 4],
      complexity: ['error', 16],
      'max-params': ['error', 6],
      'max-statements': ['error', 35],
      'no-else-return': ['error', { allowElseIf: false }],
      'max-lines-per-function': [
        'error',
        { max: 140, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-nested-callbacks': ['error', 3],
      'sonarjs/cognitive-complexity': ['error', 10],
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/prefer-immediate-return': 'warn',
      ...typeAwareRules,
    },
  },
  {
    files: ['app/models/**/*.{ts,tsx}'],
    languageOptions: typeAwareLanguageOptions,
    plugins: {
      sonarjs,
    },
    rules: {
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      'max-lines-per-function': [
        'error',
        { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'no-else-return': ['error', { allowElseIf: false }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'sonarjs/cognitive-complexity': ['error', 8],
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/prefer-immediate-return': 'warn',
      ...typeAwareRules,
    },
  },
  {
    files: ['app/lib/toast.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx,js,jsx}', 'tests/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-underscore-dangle': 'off',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // CLI tools, seeds and migrations are meant to write to stdout/stderr.
    files: ['scripts/**/*.{js,ts,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
