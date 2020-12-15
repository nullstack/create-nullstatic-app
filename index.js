#! /usr/bin/env node

const folder = process.argv[2] || 'static';

const reserved = ['public', '.production', '.development', 'src'];

if(reserved.includes(folder)) {
  console.log('\x1b[31m%s\x1b[0m', `You cannot use a folder named "${folder}"`);
  process.exit();
}

const fetch = require('node-fetch');
const links = {};
const {existsSync, mkdirSync, writeFileSync, copySync, readdirSync, rmdirSync} = require('fs-extra');
const {execSync, fork} = require('child_process');

let key;
let project;
const pages = {};

async function crawl(port, path) {
  
  links[path] = true;
  const response = await fetch('http://localhost:' + port + path);
  const html = await response.text();

  if(!existsSync(folder + path)) {
    mkdirSync(folder + path, {recursive: true});
  }

  writeFileSync(folder + path + '/index.html', html);

  if(key === undefined) {
    const environmentLookup = 'window.environment = ';
    const environment = html.split("\n").find((line) => line.indexOf(environmentLookup) > -1).split(environmentLookup)[1].slice(0, -1);
    key = JSON.parse(environment).key;
  }

  if(project === undefined) {
    const contextLookup = 'window.context = ';
    const context = html.split("\n").find((line) => line.indexOf(contextLookup) > -1).split(contextLookup)[1].slice(0, -1);
    project = JSON.parse(context).project;
  }

  const instancesLookup = 'window.instances = ';
  const instances = html.split("\n").find((line) => line.indexOf(instancesLookup) > -1).split(instancesLookup)[1].slice(0, -1);

  const pageLookup = 'window.page = ';
  const page = html.split("\n").find((line) => line.indexOf(pageLookup) > -1).split(pageLookup)[1].slice(0, -1);
  pages[path] = JSON.parse(page);
  
  const json = `{"instances": ${instances}, "page": ${page}}`;
  writeFileSync(folder + path + '/index.json', json);

  const pattern = /<a href="(.*?)"/g;
  while(match=pattern.exec(html)){
    const link = match[1];
    if(link.startsWith('/')) {
      if(links[link] === undefined) {
        links[link] = false;
      }
    }
  }

  for(const link in links) {
    if(!links[link]) {
      await crawl(port, link);
    }
  }
  
};

async function copyPath(port, path) {
  const response = await fetch(`http://localhost:${port}${path}`);
  const json = await response.text();
  writeFileSync(folder + path, json);
}

async function createSitemap() {
  const timestamp = new Date().toJSON().substring(0,10);
  const urls = Object.keys(pages).map((path) => {
    const page = pages[path];
    const canonical = `https://${project.domain}${path}`;
    return `<url><loc>${canonical}</loc><lastmod>${timestamp}</lastmod>${page.changes ? `<changefreq>${page.changes}</changefreq>` : ''}${page.priority ? `<priority>${page.priority}</priority>` : ''}</url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  writeFileSync(folder + '/sitemap.xml', xml);
}

async function run() {
  rmdirSync(folder, {recursive: true});
  await execSync('npm run build');
  const server = fork('.production/server.js', ['--static'], {silent: true});
  server.stdout.on('data', async (buffer) => {
    const lookup = 'production mode at http://127.0.0.1:';
    const message = buffer.toString('utf-8');
    if(message.indexOf(lookup) > -1) {
      const port = parseInt(message.split(lookup)[1]);
      await crawl(port, '/');
      await crawl(port, `/offline-${key}`);
      await copyPath(port, `/manifest-${key}.json`);
      await copyPath(port, `/service-worker-${key}.js`);
      await copyPath(port, `/robots.txt`);
      await createSitemap();
      server.kill();
      copySync('public', folder);
      for(const file of readdirSync('.production')) {
        if(file.startsWith('client')) {
          copySync('.production/' + file, folder + '/' + file.replace('.', `-${key}.`));
        }
      }
      console.log('\x1b[36m%s\x1b[0m', 'Yay! Your static Nullstack application is ready.');
    }
  });  
}

run();