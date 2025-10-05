import fs from 'fs';
import * as playdl from 'play-dl';
import yts from 'yt-search';
import {
  getGuildQueue,
  ensureConnection,
  startIfIdle,
  skip as skipQueue,
  clearQueue,
  destroyGuildQueue
} from '../music/queue.js';
import { VoiceConnectionStatus } from '@discordjs/voice';

// ======== Token / Cookie / User-Agent / SoundCloud client_id 初始化 ========
const tokens = {
  useragent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

let scClientId = null;

if (fs.existsSync('./cookies.txt')) {
  const cookie = fs.readFileSync('./cookies.txt', 'utf8').trim();
  tokens.youtube = { cookie };
  console.log('✅ YouTube Cookie 已加载');
} else {
  console.warn('⚠️ 没有找到 cookies.txt，可能会被 YouTube 拦截');
}

try {
  scClientId = process.env.SOUNDCLOUD_CLIENT_ID || await playdl.getFreeClientID();
  if (scClientId) {
    tokens.soundcloud = { client_id: scClientId };
    console.log('✅ SoundCloud client_id 已配置');
  } else {
    console.warn('⚠️ 未获取到 SoundCloud client_id，将无法使用 SoundCloud 回退');
  }
} catch (e) {
  console.warn('⚠️ 获取 SoundCloud client_id 失败，将无法使用 SoundCloud 回退：', e?.message || e);
}

await playdl.setToken(tokens);

// ======== 搜索（yt-search），并返回 { id, title, url, fallbackQuery } ========
async function getRandomTrackForArtist(artist, excludeIds = new Set()) {
  let res = await yts(artist);
  let candidates = (res.videos || []).filter(v =>
    v.videoId && !excludeIds.has(v.videoId) && v.url && v.title && (v.seconds ?? 0) >= 60
  );

  if (candidates.length < 5) {
    const res2 = await yts(`${artist} audio OR lyrics`);
    const more = (res2.videos || []).filter(v =>
      v.videoId && !excludeIds.has(v.videoId) && v.url && v.title && (v.seconds ?? 0) >= 60
    );
    const seen = new Set(candidates.map(v => v.videoId));
    for (const v of more) if (!seen.has(v.videoId)) candidates.push(v);
  }

  if (!candidates.length) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return { id: pick.videoId, title: pick.title, url: pick.url, fallbackQuery: artist };
}

// ======== 拉流（YT → SC 回退）========
async function fetchStream(urlOrYtUrl, fallbackQuery) {
  try {
    return await playdl.stream(urlOrYtUrl);
  } catch (err) {
    const combined = String(err?.message || err || '');
    const needVerify = /not a bot|confirm you.?re not a bot|captcha|consent|429|410/i.test(combined);
    if (!needVerify) throw err;

    if (!scClientId) throw new Error('YouTube 要求验证且未配置 SoundCloud client_id');

    const sc = await playdl.search(fallbackQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
    if (!sc?.[0]?.url) throw new Error('回退 SoundCloud 未找到可用音源');
    return await playdl.stream(sc[0].url);
  }
}

// ======== 最近播放去重（每个 guild 记录若干最近 id）========
const recentByGuild = new Map(); // guildId -> { artist: string, ids: Set<string>, max: number }

function getRecentSet(guildId, artist) {
  let rec = recentByGuild.get(guildId);
  if (!rec || rec.artist !== artist) {
    rec = { artist, ids: new Set(), max: 12 };
    recentByGuild.set(guildId, rec);
  }
  return rec;
}
function rememberPlayed(guildId, artist, id) {
  const rec = getRecentSet(guildId, artist);
  if (!id) return;
  rec.ids.add(id);
  if (rec.ids.size > rec.max) {
    const first = rec.ids.values().next().value;
    rec.ids.delete(first);
  }
}

// ======== 指令：!sing <歌手> —— 清场后开启“随机电台” ========
export async function handleSingCommand(message, artist) {
  // 关键：先清场，避免旧播放器残留导致“听到的总是第一首”
  destroyGuildQueue(message.guild.id);

  const channel = message.member?.voice?.channel;
  if (!channel) return void message.reply('❌ 你需要先加入语音频道');

  const guildQueue = getGuildQueue(message.guild.id);
  try {
    await ensureConnection(guildQueue, message.guild, channel);
  } catch (e) {
    console.error('语音连接失败:', e);
    return void message.reply('❌ 无法连接到语音频道，请稍后再试。');
  }

  const recent = getRecentSet(message.guild.id, artist);
  const first = await getRandomTrackForArtist(artist, recent.ids);
  if (!first) return void message.reply(`😢 没找到和 **${artist}** 相关的歌曲`);

  rememberPlayed(message.guild.id, artist, first.id);

  guildQueue.queue.push(first);
  await message.reply(
    `📻 已开启 **${artist}** 电台模式（随机无限播放）。\n` +
    `➕ 已加入：**${first.title}**\n` +
    `➡️ \`!another\` 换下一首，\`!stop\` 结束。`
  );

  const getNextTrack = async () => {
    const next = await getRandomTrackForArtist(artist, recent.ids);
    if (next) rememberPlayed(message.guild.id, artist, next.id);
    return next;
  };

  await startIfIdle(
    guildQueue,
    fetchStream,
    (track) => message.channel.send(`🎶 正在播放：**${track.title}**`),
    (err, track) => {
      console.error('播放出错:', err);
      message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，尝试下一首…`);
    },
    () => message.channel.send('✅ 电台播放结束（或已停止）。'),
    getNextTrack
  );
}

// ======== 指令：!another —— 切到同歌手下一首（避重） ========
export async function handleAnotherCommand(message) {
  const guildQueue = getGuildQueue(message.guild.id);
  const nowArtist = guildQueue?.nowPlaying?.fallbackQuery || null;
  if (!guildQueue || !nowArtist) {
    return void message.reply('📭 还没有在播放电台。先用 `!sing <歌手>` 开始吧。');
  }

  const recent = getRecentSet(message.guild.id, nowArtist);

  const getNextTrack = async () => {
    const next = await getRandomTrackForArtist(nowArtist, recent.ids);
    if (next) rememberPlayed(message.guild.id, nowArtist, next.id);
    return next;
  };

  await skipQueue(
    guildQueue,
    fetchStream,
    (track) => message.channel.send(`⏭️ 下一首：**${track.title}**`),
    (err, track) => {
      console.error('切歌出错:', err);
      message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，尝试下一首…`);
    },
    () => message.channel.send('✅ 电台播放结束（或已停止）。'),
    getNextTrack
  );
}

// ======== 指令：!skip / !stop / !queue ========
export async function handleSkipCommand(message) {
  const q = getGuildQueue(message.guild.id);
  if (!q || (!q.nowPlaying && q.queue.length === 0)) {
    return void message.reply('📭 队列为空，无法切歌。');
  }
  await skipQueue(
    q,
    fetchStream,
    (track) => message.channel.send(`⏭️ 下一首：**${track.title}**`),
    (err, track) => {
      console.error('切歌出错:', err);
      message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，尝试下一首…`);
    },
    () => message.channel.send('✅ 电台播放结束（或已停止）。'),
    async () => null // 传统队列模式下可不补；电台下由 handleAnother/handleSing 传入
  );
}

export async function handleStopCommand(message) {
  const q = getGuildQueue(message.guild.id);
  if (!q) return void message.reply('👌 已停止（无连接）。');
  clearQueue(q);
  try {
    if (q.connection && q.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      q.connection.destroy();
    }
  } catch (_) {}
  destroyGuildQueue(message.guild.id);
  await message.reply('🛑 已停止播放并清空队列。');
}

export async function handleQueueCommand(message) {
  const q = getGuildQueue(message.guild.id);
  const now = q?.nowPlaying ? `🎵 现在：**${q.nowPlaying.title}**` : '🎵 现在：无';
  const rest = q?.queue?.length
    ? q.queue.map((t, i) => `${i + 1}. ${t.title}`).slice(0, 10).join('\n')
    : '（空）';
  await message.reply(`${now}\n📜 队列：\n${rest}`);
}