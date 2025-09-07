module.exports = {
  root: true,
  parser: "@babel/eslint-parser",
  parserOptions: {
    requireConfigFile: false,
    ecmaVersion: 2023,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true
    }
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
    jest: true
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:jsx-a11y/recommended",
    "prettier"
  ],
  plugins: ["react", "react-hooks", "import", "jsx-a11y"],
  settings: {
    react: { version: "detect" },
    "import/resolver": {
      node: {
        extensions: [".js", ".jsx", ".mjs"]
      }
    }
  },
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "react/prop-types": "off",
    "import/no-unresolved": "off",
    "jsx-a11y/anchor-is-valid": "off"
  },
  overrides: [
    {
      files: ["**/*.test.js", "**/tests/**/*.js"],
      env: { jest: true }
    },
    {
      files: ["src/app/**/*.js", "src/components/**/*.jsx"],
      rules: {
        "no-unused-vars": "warn"
      }
    }
  ]
};

