// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality
const puppeteer = require('puppeteer-extra');
const fs = require('fs');
// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());


const warnIfNotUsingStealth = (browserInstance) => {
  if (!browserInstance) {
    throw new Error("No or invalid browser instance provided.");
  }
  if (!isUsingStealthPlugin(browserInstance)) {
    console.warn("🚧 WARNING: You are using puppeteer without the stealth plugin. You most likely need to use stealth plugin to scrape Opensea.")
  }
};
  
/**
 * Scrapes all collections from the Rankings page at https://opensea.io/rankings?sortBy=total_volume
 * options = {
 *   nbrOfPages: number of pages that should be scraped? (defaults to 1 Page = top 100 collections)
 *   debug: [true,false] enable debugging by launching chrome locally (omit headless mode)
 *   logs: [true,false] show logs in the console
 *   browserInstance: browser instance created with puppeteer.launch() (bring your own puppeteer instance)
 * }
 */
const rankings = async (nbrOfPages, duration, chain, output_path, optionsGiven = {}) => {
  const optionsDefault = {
    debug: false,
    logs: false,
    browserInstance: undefined,
  };
  const chains = ['ethereum', 'solana'];
  const durations = {
    '1d': 'one_day_volume',
    '7d': 'seven_day_volume',
    '30d': 'thirty_day_volume',
    'total': 'total_volume',
  }
  if(!chains.includes(chain)) {
    console.warn(`chain is not in the offical chain set. [${chains}]`);
    process.exit(1);
  }
  if(!(duration in durations)) {
    console.warn(`duration is not in the offical durations set. [${durations}]`);
    process.exit(1);
  }
  duration = durations[duration];
  const options = { ...optionsDefault, ...optionsGiven };
  const { debug, logs, browserInstance } = options;
  const customPuppeteerProvided = Boolean(optionsGiven.browserInstance);
  logs && console.log(`=== OpenseaScraper.rankings() ===\n...fetching ${nbrOfPages} pages (= top ${nbrOfPages*100} collections)`);

  // init browser
  let browser = browserInstance;
  if (!customPuppeteerProvided) {
    browser = await puppeteer.launch({
      headless: !debug, // when debug is true => headless should be false
      args: ['--start-maximized'],
    });
  }
  customPuppeteerProvided && warnIfNotUsingStealth(browser);

  const page = await browser.newPage();
  const url = `https://opensea.io/rankings?sortBy=${duration}&chain=${chain}`;
  logs && console.log("...opening url: " + url);
  await page.goto(url);

  logs && console.log("...🚧 waiting for cloudflare to resolve");
  await page.waitForSelector('.cf-browser-verification', {hidden: true});

  logs && console.log("...exposing helper functions through script tag")
  await page.addScriptTag({path: require.resolve("./rankingsHelperFunctions.js")});

  logs && console.log("...scrolling to bottom and fetching collections.");
  let dict = await _scrollToBottomAndFetchCollections(page);

  // scrape n pages
  for (let i = 0; i < nbrOfPages - 1; i++) {
    await _clickNextPageButton(page);
    await page.waitForSelector('.Image--image');
    logs && console.log("...scrolling to bottom and fetching collections. Items fetched so far: " + Object.keys(dict).length);
    dict = await _scrollToBottomAndFetchCollections(page);
  }
  await browser.close();
  // transform dict to array + remove invalid results
  const filtered = Object.values(dict).filter(o => o.rank !== 0 && o.name !== "");
  logs && console.log("...🥳 DONE. Total Collections fetched: " + Object.keys(dict).length);
  // order by rank
  const items = filtered.sort((a,b) => a.rank - b.rank);
  fs.writeFile(output_path, JSON.stringify(items),function (err) {
    if (err) throw err;
    console.log('It\'s saved!');
  });
  return items;
}


/**
 * Helper Functions for OpenseaScraper.rankings()
 */
async function _clickNextPageButton(page) {
  await page.click('[value=arrow_forward_ios]');
}
async function _scrollToBottomAndFetchCollections(page) {
  return await page.evaluate(() => new Promise((resolve) => {
    // keep in mind inside the browser context we have the global variable "dict" initialized
    // defined inside src/helpers/rankingsHelperFunctions.js
    var scrollTop = -1;
    const interval = setInterval(() => {
      console.log("another scrol... dict.length = " + Object.keys(dict).length);
      window.scrollBy(0, 50);
      // fetchCollections is a function that is exposed through page.addScript() and
      // is defined inside src/helpers/rankingsHelperFunctions.js
      fetchCollections(dict);
      if(document.documentElement.scrollTop !== scrollTop) {
        scrollTop = document.documentElement.scrollTop;
        return;
      }
      clearInterval(interval);
      resolve(dict);
    }, 5);
  }));
}


// options
const options = { 
  debug: false,
  logs: true,
  sort: true,
}
const argv = process.argv;
if(argv.length != 6) {
  console.error(`Argv numbers error, format: node rankings.js nbrOfPages duration chain output.`);
  process.exit(1);
}

console.log(argv.slice(2));
const nbrOfPages = argv[2];
const duration = argv[3];
const chain = argv[4];
const output = argv[5];

rankings(nbrOfPages, duration, chain, output, options);

