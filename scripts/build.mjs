import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const staticBuild = process.argv.includes("--pages");
const files = [
  ["/theme-init.js", "web/theme-init.js", "text/javascript; charset=utf-8", true],
  ["/app.js", "web/app.js", "text/javascript; charset=utf-8", true],
  ["/styles.css", "web/styles.css", "text/css; charset=utf-8", true],
  ["/assets/icon.svg", "assets/icon.svg", "image/svg+xml"],
  ["/assets/clouds.webp", "web/assets/clouds.webp", "image/webp"],
  ["/assets/dm-sans.woff2", "web/assets/dm-sans.woff2", "font/woff2"],
  ["/assets/dm-sans-OFL.txt", "web/assets/dm-sans-OFL.txt", "text/plain; charset=utf-8"],
];

function packageAsset(content, type) {
  const etag = `"${createHash("sha256").update(content).digest("hex").slice(0, 24)}"`;
  return { type, etag, data: Buffer.from(content).toString("base64") };
}

const assets = await Promise.all(files.map(async ([route, file, type, bundle]) => {
  const content = bundle
    ? (await build({ absWorkingDir: root, entryPoints: [file], bundle: true, minify: true, external: ["/assets/*", "./assets/*"], define: { __SKYLENS_STATIC__: String(staticBuild) }, format: "esm", write: false }))
      .outputFiles[0].contents
    : await readFile(new URL(`../${file}`, import.meta.url));
  return [route, packageAsset(content, type)];
}));

let markup = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
for (const [route, { etag }] of assets) {
  if (route === "/app.js" || route === "/styles.css" || route === "/theme-init.js") {
    markup = markup.replace(`"${route}"`, `"${route}?v=${etag.slice(1, -1)}"`);
  }
}
assets.push(["/", packageAsset(markup, "text/html; charset=utf-8")]);

if (staticBuild) {
  const directory = new URL("../dist/pages/", import.meta.url);
  for (const [route, asset] of assets) {
    const destination = new URL(route === "/" ? "index.html" : route.slice(1), directory);
    await mkdir(new URL(".", destination), { recursive: true });
    const content = route === "/"
      ? markup.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./')
      : Buffer.from(asset.data, "base64");
    await writeFile(destination, content);
  }
  await writeFile(new URL(".nojekyll", directory), "");
  console.log("Built GitHub Pages site in dist/pages");
  process.exit(0);
}

await mkdir(new URL("../dist/server/", import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  stdin: {
    sourcefile: "skylens-worker.js",
    resolveDir: root,
    contents: `
      import { createApp } from "./server/app.js";
      function decode(data) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      const assets = new Map(${JSON.stringify(assets)}.map(([path, { type, etag, data }]) => {
        let bytes;
        return [path, { type, etag, body: () => bytes ??= decode(data) }];
      }));
      const app = createApp({ assets });
      export default {
        fetch(request, env) {
          return app(request, {
            contact: env?.WEATHER_CONTACT,
            ip: request.headers.get("CF-Connecting-IP") ?? "edge",
            requireSignIn: env?.SKYLENS_REQUIRE_SIGN_IN === "1"
          });
        }
      };
    `,
  },
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/server/index.js",
});
console.log("Built Skylens in dist/server/index.js");
