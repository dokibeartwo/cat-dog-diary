import {defineConfig,loadEnv} from 'vite';
import {createRequire} from 'node:module';
const {validateCloudConfig}=createRequire(import.meta.url)('./scripts/cloud-config.cjs');

// One static build works both at localhost / and GitHub's /cat-dog-diary/.
// Runtime artwork and manifest URLs must stay relative as well.
export default defineConfig(({mode})=>{
 const config=validateCloudConfig({...loadEnv(mode,process.cwd(),'VITE_'),...process.env});
 return {base:'./',build:{sourcemap:false},define:{__CLOUD_CONFIG__:JSON.stringify(config.configured?{url:config.url,key:config.key}:null)},
 plugins:[{name:'exact-cloud-csp',transformIndexHtml(html){return config.configured?html.replace("connect-src 'self';",`connect-src 'self' ${config.url};`):html;}}]};
});
