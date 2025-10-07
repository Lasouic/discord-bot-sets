import * as playdl from 'play-dl';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

let initPromise;

async function configureTokens() {
  const tokens = {
    useragent: DEFAULT_USER_AGENT,
  };

  let scClientId = process.env.SOUNDCLOUD_CLIENT_ID;

  if (!scClientId) {
    try {
      scClientId = await playdl.getFreeClientID();
    } catch (error) {
      console.warn('⚠️ 获取 SoundCloud client_id 失败：', error?.message || error);
    }
  }

  if (scClientId) {
    tokens.soundcloud = { client_id: scClientId };
    console.log('✅ SoundCloud client_id 已配置');
  } else {
    console.warn('⚠️ 未获得 SoundCloud client_id。仅使用 SoundCloud 会失败，请在 .env 中设置 SOUNDCLOUD_CLIENT_ID。');
  }

  await playdl.setToken(tokens);
  return { scClientId, tokens };
}

export function getPlaybackTokens() {
  if (!initPromise) initPromise = configureTokens();
  return initPromise;
}