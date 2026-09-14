// Pure helpers for reading a GitHub release, unit-tested.

const versionParts = (version) => String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)

function isNewerVersion(latest, current) {
  const a = versionParts(latest)
  const b = versionParts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

const isGitHubUrl = (url) => typeof url === 'string' && url.startsWith('https://github.com/')

// The download for this Mac (`arch` is process.arch: arm64 or x64), or null when nothing is newer.
// Without a matching .dmg it falls back to the release page.
function macUpdate(release, current, arch) {
  if (!release || release.draft || release.prerelease || !isNewerVersion(release.tag_name, current)) return null
  if (!isGitHubUrl(release.html_url)) return null
  const asset = (Array.isArray(release.assets) ? release.assets : []).find(
    (item) => typeof item?.name === 'string' && item.name.endsWith(`-mac-${arch}.dmg`) && isGitHubUrl(item.browser_download_url),
  )
  return {
    version: versionParts(release.tag_name).join('.'),
    download: asset ? asset.browser_download_url : release.html_url,
    page: release.html_url,
  }
}

module.exports = {isNewerVersion, macUpdate}
