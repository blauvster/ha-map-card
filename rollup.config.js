import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.js',
  output: {
    file: 'map-card.js',
    format: 'es'
  },
  plugins: [nodeResolve(), commonjs()]
};