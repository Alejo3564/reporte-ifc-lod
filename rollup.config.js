import resolve  from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy     from "rollup-plugin-copy";

export default {
  input: "src/main.js",
  output: {
    file:   "dist/bundle.js",
    format: "iife",
    name:   "App",
    inlineDynamicImports: true,
  },
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    copy({
      targets: [
        // WASM de web-ifc (requerido por @thatopen)
        { src: "node_modules/web-ifc/*.wasm", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
  ],
};
