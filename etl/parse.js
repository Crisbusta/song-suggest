export function parseCatalogPage(page, fromOffset) {
  const songs = []
  const tracks = []

  page.forEach((raw, i) => {
    songs.push({
      songId: raw.songId,
      artistId: raw.artistId ?? 0,
      artist: raw.artist ?? '',
      title: raw.title ?? '',
      hasChords: raw.hasChords ? 1 : 0,
      catalogRank: fromOffset + i,
    })

    ;(raw.tracks ?? []).forEach((t, trackIndex) => {
      tracks.push({
        songId: raw.songId,
        trackIndex,
        instrumentId: t.instrumentId ?? null,
        instrument: t.instrument ?? 'Unknown',
        name: t.name ?? null,
        difficulty: Number.isInteger(t.difficulty) ? t.difficulty : null,
        views: t.views ?? null,
        tuning: Array.isArray(t.tuning) ? JSON.stringify(t.tuning) : null,
      })
    })
  })

  return { songs, tracks }
}

const flag = (v, porDefecto = 0) => (v === undefined || v === null ? porDefecto : v ? 1 : 0)

export function parseMeta(meta) {
  return {
    songId: meta.songId,
    views: meta.views ?? null,
    fingerstyle: flag(meta.fingerstyle),
    hasChords: flag(meta.hasChords),
    aiGenerated: flag(meta.aiGenerated),
    isJunk: flag(meta.isJunk),
    isBlank: flag(meta.isBlank),
    isPublished: flag(meta.isPublished, 1),
    tags: Array.isArray(meta.tags) ? meta.tags.filter(t => typeof t === 'string') : [],
    videos: JSON.stringify(
      (Array.isArray(meta.videos) ? meta.videos : [])
        .filter(v => v && v.videoId)
        .map(v => ({ videoId: v.videoId, feature: v.feature ?? null }))
    ),
  }
}
