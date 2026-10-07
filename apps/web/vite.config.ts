import {defineConfig} from 'vite';

// One static build works both at localhost / and GitHub's /cat-dog-diary/.
// Runtime artwork and manifest URLs must stay relative as well.
export default defineConfig({base:'./',build:{sourcemap:false}});
