import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  preflight: true,
  jsxFramework: "react",
  include: ["./src/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  strictPropertyValues: true,
  globalCss: {
    "html, body": {
      margin: 0,
      width: "100%",
      height: "100%",
      overflow: "hidden",
    },
  },
});
