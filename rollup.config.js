import resolve  from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy     from "rollup-plugin-copy";

export default {
  input: "src/main.js",
  output: {
    file:   "dist/bundle.js",
    format: "es",
    inlineDynamicImports: true,
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ["browser", "module", "default"],
      // Forzar que web-ifc se resuelva desde node_modules
      dedupe: ["three", "web-ifc"],
    }),
    commonjs({
      transformMixedEsModules: true,
      // Incluir web-ifc aunque tenga require() dinámico
      include: /node_modules/,
    }),
    copy({
      targets: [
        { src: "node_modules/@thatopen/fragments/dist/Worker/worker.mjs", dest: "dist" },
        { src: "node_modules/web-ifc/*.wasm", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
  ],
  onwarn(warning, warn) {
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    if (warning.code === "THIS_IS_UNDEFINED") return;
    warn(warning);
  },
};
