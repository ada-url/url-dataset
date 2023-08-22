import fs from 'node:fs'

import cli_progress from 'cli-progress'
import fetch from 'node-fetch'
import fastq from 'fastq'
import * as cheerio from 'cheerio'
import top_sites from 'top-sites/top-sites.json' assert { type: 'json' }
import constants from './constants.js'

const cli_bar = new cli_progress.SingleBar({
  etaBuffer: 100,
}, cli_progress.Presets.shades_classic)

const visited_links = new Set()
const visited_root_domains = new Map()
const queue = fastq.promise(worker, constants.concurrency)
const writeStream = fs.createWriteStream(new URL('../out.txt', import.meta.url), { flags: 'w' })
let wroteToFile = false

console.log(`
  Node version: ${process.version}
  Ada version: ${process.versions.ada ?? 'unavailable'}
`)

cli_bar.start(constants.target_output_size, 0)

async function worker({ url, root_domain }) {
  const response = await fetch(url)

  if (!response.ok) return

  const text = await response.text()
  const $ = cheerio.load(text)

  cli_bar.update(visited_links.size)

  if (visited_root_domains.get(root_domain) > constants.maximum_links_per_root_domain)
    return

  if (visited_links.size >= constants.target_output_size) {
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

    if (current_domain_count > constants.maximum_links_per_root_domain) return
    if (!href.startsWith('http')) return
    if (visited_links.has(href)) return

    visited_root_domains.set(root_domain, current_domain_count + 1)
    visited_links.add(href)
    writeStream.write(`${href}\n`)

    try {
      queue.push({
        url: href,
        root_domain: new URL(href).hostname,
      })
    } catch {
      // Omit invalid values
    }
  })
}

async function run() {
  for (let { rootDomain } of top_sites.slice(0, constants.root_domain_count)) {
    visited_root_domains.set(rootDomain, 1)
    await queue.push({
      url: `https://${rootDomain.trim()}`,
      root_domain: rootDomain,
    })
  }
}

run()
  .catch(error => {
    console.error(error)
    process.exit(0)
  })
