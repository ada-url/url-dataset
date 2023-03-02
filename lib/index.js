import fs from 'node:fs'

import cli_progress from 'cli-progress'
import fetch from 'node-fetch'
import fastq from 'fastq'
import cheerio from 'cheerio'
import top_sites from 'top-sites/top-sites.json' assert { type: 'json' }

const cli_bar = new cli_progress.SingleBar({
  etaBuffer: 100,
}, cli_progress.Presets.shades_classic)

// Used to limit the output file line count
const TARGET_OUTPUT_SIZE = 100_000

// Used to limit maximum links per domain
const MAX_ROOT_DOMAIN_LINK_LIMIT = 50

// Concurrent requests
const CONCURRENCY = 50

const visited_links = new Set()
const visited_root_domains = new Map()
const writeStream = fs.createWriteStream(new URL('../out.txt', import.meta.url), { flags: 'w' })

cli_bar.start(TARGET_OUTPUT_SIZE, 0)

const queue = fastq.promise(worker, CONCURRENCY)

let wroteToFile = false

async function worker({ url, root_domain }) {
  const response = await fetch(url)

  if (!response.ok) return

  const text = await response.text()
  const $ = cheerio.load(text)

  cli_bar.update(visited_links.size)

  if (visited_root_domains.get(root_domain) > MAX_ROOT_DOMAIN_LINK_LIMIT)
    return

  if (visited_links.size > TARGET_OUTPUT_SIZE) {
    if (!wroteToFile) {
      writeStream.end(() => process.exit(1))
      wroteToFile = true
    }
    cli_bar.stop()
    queue.killAndDrain()
    return
  }

  $('a').each((index, element) => {
    let href = $(element).attr('href')
    let current_domain_count = visited_root_domains.get(root_domain)

    if (current_domain_count > MAX_ROOT_DOMAIN_LINK_LIMIT)
      return

    if (!href.startsWith('http')) {
      return
    }

    if (!visited_links.has(href)) {
      visited_root_domains.set(root_domain, current_domain_count + 1)
      visited_links.add(href)
      writeStream.write(`${href}\n`)
      queue.push({
        url: href,
        root_domain: new URL(href).hostname,
      })
    }
  })

}

async function run() {
  for (let { rootDomain } of top_sites.slice(0, 10)) {
    visited_root_domains.set(rootDomain, 1)
    await queue.push({
      url: `https://${rootDomain}`,
      root_domain: rootDomain,
    })
  }
}

run().catch(console.error)
