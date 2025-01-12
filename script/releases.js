import fs from 'fs'
import Bottleneck from 'bottleneck'
import github from '../lib/github.js'
import parseGitUrl from 'github-url-to-object'
import apps from '../lib/raw-app-list.js'
import humanInterval from 'human-interval'
import appsWithRepos from '../lib/apps-with-github-repos.js'
import path from 'path'
import { _dirname } from '../lib/dirname.js'

const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY) || 4 // simultaneous open web requests
const RELEASE_CACHE_TTL = humanInterval(
  process.env.RELEASE_CACHE_TTL || '4 hours'
)

const outputFile = path.join(_dirname(import.meta), '../meta/releases.json')
const oldReleaseData = JSON.parse(fs.readFileSync(outputFile))
const output = {}
const limiter = new Bottleneck({
  maxConcurrent: MAX_CONCURRENCY,
})

console.log(
  `${appsWithRepos.length} of ${apps.length} apps have a GitHub repo.`
)
console.log(
  `${appsWithRepos.filter(shouldUpdateAppReleaseData).length} of those ${
    appsWithRepos.length
  } have missing or outdated release data.`
)

appsWithRepos.forEach((app) => {
  if (shouldUpdateAppReleaseData(app)) {
    limiter
      .schedule(getLatestRelease, app)
      .then((release) => {
        console.log(`${app.slug}: got latest release`)
        output[app.slug] = {
          latestRelease: release.data,
          latestReleaseFetchedAt: new Date(),
        }
      })
      .catch((err) => {
        console.error(`${app.slug}: no releases found`)
        output[app.slug] = {
          latestRelease: null,
          latestReleaseFetchedAt: new Date(),
        }
        if (err.status !== 404) console.error(err)
      })
  } else {
    output[app.slug] = oldReleaseData[app.slug]
  }
})

limiter.on('error', (err) => {
  console.error(err)
})

limiter.on('idle', () => {
  setTimeout(() => {
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2))
    console.log(`Done fetching release data.\nWrote ${outputFile}`)
    process.exit()
  }, 1000)
})

function shouldUpdateAppReleaseData(app) {
  const oldData = oldReleaseData[app.slug]
  if (!oldData || !oldData.latestReleaseFetchedAt) return true
  const oldDate = new Date(oldData.latestReleaseFetchedAt || null).getTime()
  return oldDate + RELEASE_CACHE_TTL < Date.now()
}

function getLatestRelease(app) {
  const { user: owner, repo } = parseGitUrl(app.repository)
  const opts = {
    owner: owner,
    repo: repo,
    headers: {
      Accept: 'application/vnd.github.v3.html',
    },
  }

  return github.repos.getLatestRelease(opts)
}
