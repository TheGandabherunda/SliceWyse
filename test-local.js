import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

(async () => {
  const html = fs.readFileSync('dist/index.html', 'utf8');
  
  // Create a minimal jsdom environment
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: "dangerously",
    resources: "usable"
  });

  // Intercept scripts and load from disk to bypass network
  const originalLoader = dom.window.document.createElement;
  dom.window.document.createElement = function(tagName) {
    const el = originalLoader.apply(this, arguments);
    return el;
  };

  dom.virtualConsole.on("jsdomError", (error) => console.error("JSDOM Error:", error.message));
  dom.virtualConsole.on("log", (...args) => console.log("LOG:", ...args));
  dom.virtualConsole.on("error", (...args) => console.error("ERROR:", ...args));
  dom.virtualConsole.on("warn", (...args) => console.warn("WARN:", ...args));

  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log("HTML Rendered:");
  console.log(dom.window.document.getElementById('root').innerHTML);
})();
