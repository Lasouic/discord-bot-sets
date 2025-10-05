import yts from 'yt-search';

export async function searchYoutube(query) {
  const res = await yts(query);
  const v = (res.videos || [])[0];
  if (!v) return null;
  return { title: v.title, url: v.url };
}