import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const GSTATIC_MODELS_BASE = 'https://www.gstatic.com/aistudio/starter-apps/desk-racer/models';
const GLB_FILES = [
  'desk_props.glb',
  'kart_1to87.glb',
  'room_environment.glb',
  'track_coaster.glb',
];

function fetchGstaticModelsOnBuild(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fetch-gstatic-models-on-build',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    async closeBundle() {
      const assetsModelsDir = path.resolve(outDir, 'assets/models');
      const apiModelsDir = path.resolve(outDir, 'api/gstatic-models');
      await Promise.all([
        fs.mkdir(assetsModelsDir, { recursive: true }),
        fs.mkdir(apiModelsDir, { recursive: true }),
      ]);

      await Promise.all(
        GLB_FILES.map(async (file) => {
          const url = `${GSTATIC_MODELS_BASE}/${file}`;
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          await Promise.all([
            fs.writeFile(path.join(assetsModelsDir, file), buffer),
            fs.writeFile(path.join(apiModelsDir, file), buffer),
          ]);
        })
      );
    },
  };
}

const GSTATIC_MODELS_PATH = '/aistudio/starter-apps/desk-racer/models';

// Only proxy the known GLB files. Rejects path traversal ('..', encoded
// '%2e%2e' / '%2f', backslashes) and drops query strings by construction.
function safeModelsRewrite(prefix: RegExp) {
  return (reqPath: string) => {
    const rest = reqPath.replace(prefix, '').split('?')[0].split('#')[0];
    let file = '';
    try {
      file = decodeURIComponent(rest).replace(/^\/+/, '');
    } catch {
      file = '';
    }
    if (!GLB_FILES.includes(file)) {
      return `${GSTATIC_MODELS_PATH}/__not_found__.glb`;
    }
    return `${GSTATIC_MODELS_PATH}/${file}`;
  };
}

const gstaticModelsProxy = {
  '/api/gstatic-models': {
    target: 'https://www.gstatic.com',
    changeOrigin: true,
    rewrite: safeModelsRewrite(/^\/api\/gstatic-models/),
  },
  '/assets/models': {
    target: 'https://www.gstatic.com',
    changeOrigin: true,
    rewrite: safeModelsRewrite(/^\/assets\/models/),
  },
};

export default defineConfig({
  plugins: [fetchGstaticModelsOnBuild()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: gstaticModelsProxy,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    proxy: gstaticModelsProxy,
  },
});
