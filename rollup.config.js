import resolve  from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy     from "rollup-plugin-copy";

export default {
  input: "src/main.js",
  output: {
    file:   "dist/bundle.js",
    format: "es",           // ES module — compatible con @thatopen
    inlineDynamicImports: true,
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ["browser", "module", "default"],
    }),
    commonjs({
      transformMixedEsModules: true,
    }),
    copy({
      targets: [
        { src: "node_modules/@thatopen/fragments/dist/Worker/worker.mjs", dest: "dist" },
        { src: "node_modules/web-ifc/*.wasm", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
  ],
  // Suprimir warnings de circular deps en librerías externas
  onwarn(warning, warn) {
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    if (warning.code === "THIS_IS_UNDEFINED") return;
    warn(warning);
  },
};
