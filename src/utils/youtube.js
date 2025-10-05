import * as playdl from 'play-dl';

export async function searchYoutube(query) {
    const results = await playdl.search(`${query} audio`, {
    source: { youtube: 'video' },
    limit: 5
  });

  const pick = results.find(r => r.type === 'video') || results[0];
  if (!pick) return null;

  return {
    title: pick.title,
    url: pick.url
  };
}