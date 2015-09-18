import AppCache from './app-cache';
import ServiceWorker from './service-worker';

import path from 'path';
import deepExtend from 'deep-extend';

const REST_KEY = ':rest:';

const hasOwn = {}.hasOwnProperty;
const defaultOptions = {
  caches: 'all',
  scope: '/',
  get version() {
    return (new Date).toLocaleString();
  },
  rewrites(asset) {
    return asset.replace(/^([\s\S]*?)index.htm(l?)$/, (match, dir) => {
      return dir || '/';
    });
  },

  ServiceWorker: {
    output: 'sw.js',
    entry: path.join(__dirname, '../misc/sw-entry.js')
  },

  AppCache: {
    NETWORK: '*',
    directory: 'appcache/'
  }
}

export default class OfflinePlugin {
  constructor(options) {
    this.options = deepExtend({}, defaultOptions, options);
    this.assets = null;
    this.version = this.options.version + '';
    this.scope = this.options.scope.replace(/\/$/, '/');

    const rewrites = this.options.rewrites || defaultOptions.rewrites;

    if (typeof rewrites === 'function') {
      this.rewrite = (asset) => {
        if (asset.indexOf(this.entryPrefix) === 0) {
          return '';
        }

        return rewrites(asset);
      };
    } else {
      this.rewrite = (asset) => {
        if (asset.indexOf(this.entryPrefix) === 0) {
          return '';
        }

        if (!hasOwn.call(rewrites, asset)) {
          return asset;
        }

        return rewrites[asset];
      };
    }

    this.entryPrefix = '__offline_';
    this.tools = {};

    this.addTool(ServiceWorker, 'ServiceWorker');
    this.addTool(AppCache, 'AppCache');

    if (!Object.keys(this.tools).length) {
      throw new Error('You should have at least one cache service to be specified');
    }
  }

  apply(compiler) {
    const runtimePath = path.resolve(__dirname, '../runtime.js');

    compiler.plugin('normal-module-factory', (nmf) => {
      nmf.plugin('after-resolve', (result, callback) => {
        if (result.resource !== runtimePath) {
          return callback(null, result);
        }

        const caches = this.options.caches;
        const data = {
          hasAdditionalCache:
            !!(caches !== 'all' && caches.additional && caches.additional.length)
        };

        this.useTools((tool, key) => {
          data[key] = tool.getConfig(this);
        });

        result.loaders.push(
          path.join(__dirname, '../misc/runtime-loader.js') +
            '?' + JSON.stringify(data)
        );

        callback(null, result);

        // data.loaders.unshift(path.join(__dirname, "postloader.js"));
      });
    });

    compiler.plugin('make', (compilation, callback) => {
      this.useTools((tool) => {
        return tool.addEntry(this, compilation, compiler);
      }).then(() => {
        callback();
      }).catch(() => {
        throw new Error('Something went wrong');
      });
    });

    compiler.plugin('emit', (compilation, callback) => {
      this.setAssets(Object.keys(compilation.assets));

      this.useTools((tool) => {
        return tool.apply(this, compilation, compiler);
      }).then(() => {
        callback();
      }).catch(() => {
        throw new Error('Something went wrong');
      });
    });
  }

  setAssets(assets) {
    const caches = this.options.caches || defaultOptions.caches;

    this.assets = assets;

    if (caches === 'all') {
      this.caches = {
        main: this.validatePaths(assets)
      };
    } else {
      this.caches = [
        'main', 'additional', 'optional'
      ].reduce((result, key) => {
        const cache = Array.isArray(caches[key]) ? caches[key] : [REST_KEY];
        let cacheResult = [];

        if (!cache.length) return result;

        cache.some((cacheKey) => {
          if (cacheKey === REST_KEY) {
            if (assets.length) {
              cacheResult = cacheResult.concat(assets);
              assets = [];
            }

            return;
          }

          const index = assets.indexOf(cacheKey);

          if (index === -1) {
            console.warn(`Cache asset [${ cacheKey }] is not found in output assets`);
          } else {
            assets.splice(index, 1);
          }

          cacheResult.push(cacheKey);
        });

        result[key] = this.validatePaths(cacheResult);

        return result;
      }, {});
    }
  }

  validatePaths(assets) {
    return assets
      .map(this.rewrite)
      .filter(asset => !!asset)
      .map(key => {
        if (key === '/') {
          return this.scope;
        }

        return this.scope + key;
      });
  };

  stripEmptyAssets(asset) {
    return !!asset;
  }

  useTools(fn) {
    const tools = Object.keys(this.tools).map((tool) => {
      return fn(this.tools[tool], tool);
    });

    return Promise.all(tools);
  }

  addTool(Tool, name) {
    let options = this.options[name];

    if (options === null || options === false) {
      // tool is not needed
      return;
    }

    this.tools[name] = new Tool(options);
  }
}